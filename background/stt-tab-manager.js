// STT 用 offscreen の生成・破棄と tabCapture 管理。ヘルスチェック、自動再キャプチャを含む。

(function (Base) {
  const MSG = Base.MSG;
  const log = Base.log.create("stt-tab");
  const OFFSCREEN_URL = "offscreen/offscreen.html";
  const OFFSCREEN_READY_TIMEOUT_MS = 5000;
  const STORAGE_KEY = "sttCaptureTabId";
  let captureTabId = null;

  // captureTabId を session storage に永続化（SW 再起動対策）
  function persistTabId(id) {
    captureTabId = id;
    chrome.storage.session.set({ [STORAGE_KEY]: id });
  }

  // --- offscreen ライフサイクル ---
  async function hasOffscreen() {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });
    return contexts.length > 0;
  }

  async function ensureOffscreen() {
    if (await hasOffscreen()) return;
    const ready = new Promise((resolve) => {
      let timeout;
      function onMsg(msg) {
        if (msg.type === MSG.OFFSCREEN_READY) {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(onMsg);
          resolve();
        }
      }
      chrome.runtime.onMessage.addListener(onMsg);
      timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(onMsg); resolve(); }, OFFSCREEN_READY_TIMEOUT_MS);
    });
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "タブ音声キャプチャによる音声認識",
    });
    await ready;
  }

  async function closeOffscreen() {
    if (await hasOffscreen()) {
      chrome.runtime.sendMessage({ type: MSG.STT_CMD, cmd: "stop" }).catch((e) => log.debug("msg dropped:", e.message));
      await chrome.offscreen.closeDocument().catch((e) => log.debug("msg dropped:", e.message));
    }
  }

  function notifyTab(tabId, show) {
    return chrome.tabs.sendMessage(tabId, { type: MSG.STT_OVERLAY, show });
  }

  // --- 再キャプチャ（ストリーム切断時の自動復旧、30秒で3回まで） ---
  const RECAPTURE_MAX = 3;
  const RECAPTURE_WINDOW_MS = 30000;
  const RECAPTURE_ATTEMPTS_KEY = "sttRecaptureAttempts";

  async function loadRecaptureAttempts() {
    const data = await chrome.storage.session.get(RECAPTURE_ATTEMPTS_KEY);
    return data[RECAPTURE_ATTEMPTS_KEY] || [];
  }

  function saveRecaptureAttempts(attempts) {
    chrome.storage.session.set({ [RECAPTURE_ATTEMPTS_KEY]: attempts });
  }

  async function recapture() {
    if (!captureTabId) return;
    const tabId = captureTabId;

    const now = Date.now();
    const recaptureAttempts = (await loadRecaptureAttempts()).filter((t) => now - t < RECAPTURE_WINDOW_MS);
    if (recaptureAttempts.length >= RECAPTURE_MAX) {
      stopCapture();
      return;
    }
    recaptureAttempts.push(now);
    saveRecaptureAttempts(recaptureAttempts);

    try {
      await ensureOffscreen();
      await chrome.tabs.get(tabId);
      if (captureTabId !== tabId) return;
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      if (captureTabId !== tabId) return;
      const cfg = await chrome.storage.local.get({ profile: UbyeBase.DEFAULT_PROFILE });
      if (captureTabId !== tabId) return;
      chrome.runtime.sendMessage({
        type: MSG.STT_CMD,
        cmd: "start-with-stream",
        streamId,
        config: { profile: cfg.profile },
      }).catch((e) => log.warn("再キャプチャのストリーム送信失敗:", e.message));
    } catch {
      stopCapture();
    }
  }

  async function startCapture(targetTabId) {
    if (captureTabId) throw new Error("別タブで使用中です");
    // 前回のストリームが残っている場合に備えて offscreen を強制クリーンアップ
    await closeOffscreen();
    persistTabId(targetTabId);
    saveRecaptureAttempts([]);
    try {
      await ensureOffscreen();
      if (captureTabId !== targetTabId) throw new Error("キャプチャが中断されました");
      const [streamId, cfg] = await Promise.all([
        chrome.tabCapture.getMediaStreamId({ targetTabId }),
        chrome.storage.local.get({ profile: UbyeBase.DEFAULT_PROFILE }),
      ]);
      if (captureTabId !== targetTabId) throw new Error("キャプチャが中断されました");
      await Promise.all([
        notifyTab(targetTabId, true),
        chrome.runtime.sendMessage({
          type: MSG.STT_CMD,
          cmd: "start-with-stream",
          streamId,
          config: { profile: cfg.profile },
        }),
      ]);
      chrome.action.setBadgeText({ text: "ON" });
      chrome.action.setBadgeBackgroundColor({ color: "#4caf50" });
      startHealthCheck();
      fireStart();
    } catch (e) {
      if (captureTabId === targetTabId) persistTabId(null);
      if (e.message?.includes("Receiving end does not exist")) {
        throw new Error("ページを再読み込みしてください");
      }
      throw e;
    }
  }

  async function stopCapture() {
    stopHealthCheck();
    if (captureTabId) {
      notifyTab(captureTabId, false).catch((e) => log.debug("msg dropped:", e.message));
      persistTabId(null);
      chrome.runtime.sendMessage({ type: MSG.STT_CAPTURE_STOPPED }).catch((e) => log.debug("msg dropped:", e.message));
    }
    chrome.action.setBadgeText({ text: "" });
    fireStop();
    await closeOffscreen();
  }

  function getCaptureTabId() {
    return captureTabId;
  }

  async function getStatus() {
    if (await hasOffscreen()) {
      chrome.runtime.sendMessage({ type: MSG.STT_CMD, cmd: "get-status" }).catch((e) => log.debug("msg dropped:", e.message));
    }
  }

  // --- ヘルスチェック（chrome.alarms で offscreen 生存確認） ---
  const HEALTH_CHECK_ALARM = "ubye-stt-health-check";
  const HEALTH_CHECK_PERIOD_MIN = 1;

  function startHealthCheck() {
    chrome.alarms.create(HEALTH_CHECK_ALARM, { periodInMinutes: HEALTH_CHECK_PERIOD_MIN });
  }

  function stopHealthCheck() {
    chrome.alarms.clear(HEALTH_CHECK_ALARM);
  }

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== HEALTH_CHECK_ALARM) return;
    if (!captureTabId) { stopHealthCheck(); return; }
    if (!(await hasOffscreen())) {
      try { await recapture(); } catch { stopCapture(); }
    }
  });

  // --- タブ監視（リロード・閉じでキャプチャ停止） ---
  // SW 再起動直後はメモリ上の captureTabId が null のため、session storage からも確認する
  async function resolveCaptureTabId() {
    if (captureTabId) return captureTabId;
    const data = await chrome.storage.session.get(STORAGE_KEY);
    const saved = data[STORAGE_KEY] || null;
    if (saved) captureTabId = saved;
    return captureTabId;
  }

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (tabId === (await resolveCaptureTabId())) stopCapture();
  });
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url && tabId === (await resolveCaptureTabId())) stopCapture();
  });
  chrome.webNavigation.onCommitted.addListener(async (details) => {
    if (details.frameId === 0 && details.transitionType === "reload" && details.tabId === (await resolveCaptureTabId())) stopCapture();
  });

  // SW 起動時に captureTabId を復元し、offscreen と整合を取る
  (async () => {
    const data = await chrome.storage.session.get(STORAGE_KEY);
    const saved = data[STORAGE_KEY];
    if (!saved) return;
    captureTabId = saved;
    if (!(await hasOffscreen())) { persistTabId(null); return; }
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#4caf50" });
    startHealthCheck();
  })();

  const captureCallbacks = { start: [], stop: [] };
  function onStart(cb) { captureCallbacks.start.push(cb); }
  function onStop(cb) { captureCallbacks.stop.push(cb); }
  function fireStart() { for (const cb of captureCallbacks.start) cb(); }
  function fireStop() { for (const cb of captureCallbacks.stop) cb(); }

  Base.sttTab = { startCapture, stopCapture, getStatus, getCaptureTabId, recapture, onStart, onStop };
})(UbyeBase);
