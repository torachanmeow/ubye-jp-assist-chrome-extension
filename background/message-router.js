// メッセージルーター。翻訳・STT 制御メッセージを受信し、適切なハンドラに振り分け。バッチ翻訳キャッシュ管理。
(function (Base) {
  const DEFAULT_MODEL = Base.DEFAULT_GEMINI_MODEL;
  const MSG = Base.MSG;
  const log = Base.log.create("router");

  // --- バッチ翻訳キャッシュ（session storage、タブ間共有） ---
  const BATCH_CACHE_KEY = "ubye_translate_cache";
  const BATCH_CACHE_MAX = 2000;

  chrome.storage.local.get({ profile: Base.DEFAULT_PROFILE }).then((cfg) => {
    Base.applyProfile(cfg.profile);
  }).catch((e) => log.warn("初期プロファイル読み込み失敗:", e.message));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.profile) {
      Base.applyProfile(changes.profile.newValue);
      chrome.storage.session.remove(BATCH_CACHE_KEY);
      chrome.runtime.sendMessage({
        type: MSG.STT_CMD,
        cmd: "update-config",
        profile: changes.profile.newValue,
        restart: true,
      }).catch((e) => log.warn("プロファイル変更の通知失敗:", e.message));
    }
    if (changes.chatModel) {
      chrome.storage.session.remove(BATCH_CACHE_KEY);
    }
  });

  async function getConfig() {
    return chrome.storage.local.get({
      geminiApiKey: "",
      chatModel: DEFAULT_MODEL,
      sendModel: DEFAULT_MODEL,
      speechModel: DEFAULT_MODEL,
    });
  }

  async function handleTranslate(systemPrompt, text, modelKey) {
    try {
      const cfg = await getConfig();
      if (!cfg.geminiApiKey) return { ok: false, error: "API Keyが未設定です" };
      const provider = Base.translationProvider;
      const translatedText = await provider.translate(systemPrompt, text, { apiKey: cfg.geminiApiKey, model: cfg[modelKey] });
      return { ok: true, translatedText };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function loadBatchCache() {
    const data = await chrome.storage.session.get(BATCH_CACHE_KEY);
    return new Map(data[BATCH_CACHE_KEY] || []);
  }

  async function saveBatchCache(cache) {
    // LRU: 上限超過時は古い順に削除
    while (cache.size > BATCH_CACHE_MAX) cache.delete(cache.keys().next().value);
    await chrome.storage.session.set({ [BATCH_CACHE_KEY]: [...cache] }).catch((e) => {
      log.warn("キャッシュ保存失敗、キャッシュをリセットします:", e.message);
      chrome.storage.session.remove(BATCH_CACHE_KEY).catch((re) => log.warn("キャッシュリセット失敗:", re.message));
    });
  }

  // race condition 対策: キャッシュ読み書きをシリアライズするPromiseキュー
  let batchCacheQueue = Promise.resolve();

  function handleTranslateBatch(texts) {
    const result = batchCacheQueue.then(() => handleTranslateBatchInner(texts));
    // キューの末尾を更新。エラーは呼び出し元に伝えるため、キュー自体はエラーで止めない
    batchCacheQueue = result.catch(() => {});
    return result;
  }

  async function handleTranslateBatchInner(texts) {
    try {
      const cfg = await getConfig();
      if (!cfg.geminiApiKey) return { ok: false, error: "API Keyが未設定です" };

      const cache = await loadBatchCache();

      // キャッシュヒット分を分離
      const results = new Array(texts.length);
      const uncachedIndices = [];
      for (let i = 0; i < texts.length; i++) {
        const cached = cache.get(texts[i]);
        if (cached !== undefined) {
          // LRU: アクセス順を更新
          cache.delete(texts[i]);
          cache.set(texts[i], cached);
          results[i] = { translatedText: cached };
        } else {
          uncachedIndices.push(i);
        }
      }

      // 未キャッシュ分のみAPI呼び出し
      if (uncachedIndices.length > 0) {
        const uncachedTexts = uncachedIndices.map((i) => texts[i]);
        const provider = Base.translationProvider;
        const translated = await provider.translateBatch(Base.PROMPTS.chat, uncachedTexts, { apiKey: cfg.geminiApiKey, model: cfg.chatModel });
        for (let j = 0; j < uncachedIndices.length; j++) {
          const idx = uncachedIndices[j];
          const trans = translated[j] || texts[idx];
          // 翻訳失敗（元テキストと同一）はキャッシュしない → 次回再試行可能
          if (trans !== texts[idx]) cache.set(texts[idx], trans);
          results[idx] = { translatedText: trans };
        }
      }

      await saveBatchCache(cache);
      return { ok: true, results };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // --- ハンドラ定義 ---
  // 非同期ハンドラは return true でレスポンスチャネルを維持する
  const asyncHandlers = {
    [MSG.TRANSLATE_SEND]: async (msg) => {
      const result = await handleTranslate(Base.PROMPTS.send, msg.text, "sendModel");
      if (result.ok && result.translatedText && Base.needsS2T()) {
        result.translatedText = Base.applyS2T(result.translatedText);
      }
      return result;
    },
    [MSG.TRANSLATE_SPEECH]: (msg) =>
      handleTranslate(Base.PROMPTS.speech, msg.text, "speechModel"),
    [MSG.TRANSLATE_BATCH]: (msg) =>
      handleTranslateBatch(msg.texts),
    [MSG.STT_START_CAPTURE]: (msg) =>
      Base.sttTab.startCapture(msg.tabId)
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: e.message, code: e.code })),
  };

  const syncHandlers = {
    [MSG.STT_GET_CAPTURE_TAB]: (msg, sendResponse) => {
      sendResponse(Base.sttTab.getCaptureTabId());
    },
    [MSG.STT_STOP_CAPTURE]: (msg, sendResponse) => {
      Base.sttTab.stopCapture();
      sendResponse({ ok: true });
    },
  };

  // fire-and-forget ハンドラ。sendResponse を使わず、呼び出し元への返答を行わない。
  const notifyHandlers = {
    [MSG.STT_BROADCAST]: (msg) => {
      const tabId = Base.sttTab.getCaptureTabId();
      if (tabId) chrome.tabs.sendMessage(tabId, msg).catch((e) => log.debug("msg dropped:", e.message));
    },
  };

  const sttCmdHandlers = {
    "stream-ended": () => { Base.sttTab.recapture(); },
    "get-status": (msg, sendResponse) => { Base.sttTab.getStatus(); sendResponse({ ok: true }); },
  };

  const ASYNC_TIMEOUT_MS = 30000;

  function withTimeout(promise) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("タイムアウト")), ASYNC_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const asyncHandler = asyncHandlers[msg.type];
    if (asyncHandler) {
      withTimeout(asyncHandler(msg))
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    const syncHandler = syncHandlers[msg.type];
    if (syncHandler) {
      syncHandler(msg, sendResponse);
      return;
    }

    const notifyHandler = notifyHandlers[msg.type];
    if (notifyHandler) {
      notifyHandler(msg);
      return;
    }

    if (msg.type === MSG.STT_CMD) {
      const cmdHandler = sttCmdHandlers[msg.cmd];
      if (cmdHandler) cmdHandler(msg, sendResponse);
    }
  });
})(UbyeBase);
