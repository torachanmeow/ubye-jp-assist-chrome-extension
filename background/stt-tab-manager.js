// STT 用 offscreen の生成・破棄と tabCapture 管理。ヘルスチェック、自動再キャプチャを含む。

(function (Base) {
  const MSG = Base.MSG;
  const log = Base.log.create("stt-tab");
  const OFFSCREEN_URL = "offscreen/offscreen.html";
  const OFFSCREEN_READY_TIMEOUT_MS = 5000;
  const STORAGE_KEY = "ubye_sttCaptureTabId";
  const YOUTUBE_KEY = "ubye_sttIsYouTube";
  const YOUTUBE_ORIGIN = Base.YOUTUBE_ORIGIN;
  let captureTabId = null;
  let isYouTube = false;
  let starting = false;

  // captureTabId / isYouTube を session storage に永続化（SW 再起動対策）
  function persistTabId(id) {
    captureTabId = id;
    chrome.storage.session.set({ [STORAGE_KEY]: id });
  }

  function persistIsYouTube(value) {
    isYouTube = value;
    chrome.storage.session.set({ [YOUTUBE_KEY]: value });
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
      await chrome.runtime.sendMessage({ type: MSG.STT_CMD, cmd: "stop" }).catch((e) => log.debug("msg dropped:", e.message));
      await chrome.offscreen.closeDocument().catch((e) => log.debug("msg dropped:", e.message));
    }
  }

  function notifyTab(tabId, show) {
    return chrome.tabs.sendMessage(tabId, { type: MSG.STT_OVERLAY, show });
  }

  // --- 再キャプチャ（ストリーム切断時の自動復旧、30秒で3回まで） ---
  const RECAPTURE_MAX = 3;
  const RECAPTURE_WINDOW_MS = 30000;
  const RECAPTURE_ATTEMPTS_KEY = "ubye_sttRecaptureAttempts";

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
    await restorePromise;
    if (captureTabId) { const e = new Error("別タブで使用中です"); e.code = "busy"; throw e; }
    if (starting) throw new Error("起動処理中です");
    starting = true;
    // 前回のストリームが残っている場合に備えて offscreen を強制クリーンアップ
    await closeOffscreen();
    persistTabId(targetTabId);
    saveRecaptureAttempts([]);
    try {
      const tab = await chrome.tabs.get(targetTabId);
      persistIsYouTube(tab.url ? new URL(tab.url).origin === YOUTUBE_ORIGIN : false);
      // STT 用 content script を動的注入（notifyTab より前に実行）
      // 全ファイルに冪等性ガードがあるため、静的注入済みのファイルも安全に再注入できる。
      const sttFiles = [
        "vendor/opencc-cn2t.js",
        "base/namespace.js",
        "base/message-types.js",
        "base/lang-detect.js",
        "base/message-bus.js",
        "base/overlay.js",
        "base/config.js",
        "base/s2t-convert.js",
        "base/toast.js",
        "base/init-static.js",
        "base/stt-overlay.js",
        "base/stt-subtitle.js",
        "base/stt-lifecycle.js",
        isYouTube ? "youtube/namespace.js" : "generic/namespace.js",
        isYouTube ? "youtube/stt-subtitle.js" : "generic/stt-subtitle.js",
        isYouTube ? "youtube/init-stt.js" : "generic/init-stt.js",
        "profiles.js",
      ];
      if (!isYouTube) {
        await chrome.scripting.insertCSS({
          target: { tabId: targetTabId },
          files: ["base/base.css", "generic/generic.css"],
        });
      }
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId, allFrames: false },
        files: sttFiles,
      });
      await ensureOffscreen();
      if (captureTabId !== targetTabId) throw new Error("キャプチャが中断されました");
      const [streamId, cfg] = await Promise.all([
        chrome.tabCapture.getMediaStreamId({ targetTabId }),
        chrome.storage.local.get({ profile: UbyeBase.DEFAULT_PROFILE }),
      ]);
      if (captureTabId !== targetTabId) throw new Error("キャプチャが中断されました");
      await Promise.all([
        notifyTab(targetTabId, true),
        // start-with-stream メッセージは offscreen へ届いた時点で resolve する。
        // offscreen 内での音声認識エンジン（SpeechRecognition）の開始完了は
        // このPromiseでは保証されない。実際の認識開始は非同期で行われる。
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
      await closeOffscreen().catch(() => {});
      if (e.message?.includes("Receiving end does not exist")) {
        throw new Error("ページを再読み込みしてください");
      }
      throw e;
    } finally {
      starting = false;
    }
  }

  async function stopCapture() {
    await restorePromise;
    stopHealthCheck();
    if (captureTabId) {
      notifyTab(captureTabId, false).catch((e) => log.warn("stopCapture の notifyTab 失敗:", e.message));
      persistTabId(null);
      persistIsYouTube(false);
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

  // SW 起動時に captureTabId を復元し、offscreen と整合を取る
  // このPromiseを待つことで、タブ監視リスナーが初期化完了前に誤判定しない
  const restorePromise = (async () => {
    const data = await chrome.storage.session.get([STORAGE_KEY, YOUTUBE_KEY]);
    const saved = data[STORAGE_KEY];
    if (!saved) return;
    captureTabId = saved;
    isYouTube = data[YOUTUBE_KEY] || false;
    if (!(await hasOffscreen())) { persistTabId(null); persistIsYouTube(false); return; }
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#4caf50" });
    startHealthCheck();
    fireStart();
  })();

  // --- タブ監視（リロード・閉じでキャプチャ停止） ---
  // SW 再起動直後はメモリ上の captureTabId が null のため、復元完了を待ってから判定する
  async function resolveCaptureTabId() {
    await restorePromise;
    return captureTabId;
  }

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (tabId === (await resolveCaptureTabId())) stopCapture();
  });
  chrome.webNavigation.onCommitted.addListener(async (details) => {
    if (details.frameId === 0 && details.transitionType === "reload" && details.tabId === (await resolveCaptureTabId())) stopCapture();
  });
  // ページ遷移時の停止判定
  // YouTube: 同一オリジン内はスキップ（SPA 遷移を content script 側で管理）、別オリジンへの離脱は停止
  // それ以外: URL 変更で即停止
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!changeInfo.url) return;
    if (tabId !== (await resolveCaptureTabId())) return;
    try {
      if (isYouTube && new URL(changeInfo.url).origin === YOUTUBE_ORIGIN) return;
    } catch {}
    stopCapture();
  });

  const captureCallbacks = { start: [], stop: [] };
  function onStart(cb) { captureCallbacks.start.push(cb); }
  function onStop(cb) { captureCallbacks.stop.push(cb); }
  function fireStart() { for (const cb of captureCallbacks.start) cb(); }
  function fireStop() { for (const cb of captureCallbacks.stop) cb(); }

  Base.sttTab = { startCapture, stopCapture, getStatus, getCaptureTabId, recapture, onStart, onStop };
})(UbyeBase);
