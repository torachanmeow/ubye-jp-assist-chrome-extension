// ライブチャット・コメントのバッチ翻訳。自動翻訳タイマー、投票バナー翻訳を含む。
(function (App, Base) {
  const sendMsg = Base.sendMsg;
  const extractMessageText = App.extractMessageText;
  const SELECTORS = {
    liveChat:
      "yt-live-chat-text-message-renderer #message, " +
      "yt-live-chat-paid-message-renderer #message, " +
      "yt-live-chat-membership-item-renderer #message",
    comments:
      "ytd-comment-view-model #content-text",
  };

  const COUNTDOWN_INTERVAL_MS = 1000;
  const getBatchChunkSize = Base.createStorageValue("batchChunkSize");
  let translatedSet = new WeakSet();
  let processingSet = new WeakSet();
  let failMap = new WeakMap();
  const FAIL_MAX = 3;

  const langDetect = Base.createLangDetector(Base.langRules.ja.preset());
  const shouldSkip = langDetect.shouldSkip;

  let translatingInProgress = false;
  let translateGeneration = 0;

  const MSG = Base.MSG;

  async function translateBatch(texts) {
    const res = await Base.translate.batch(texts);
    return res.results;
  }

  function collectUntranslated(root, selector) {
    const allMessages = root.querySelectorAll(selector);
    const pending = [];
    for (let i = 0; i < allMessages.length; i++) {
      const el = allMessages[i];
      if (translatedSet.has(el) || processingSet.has(el)) continue;
      if (el.querySelector(".ytc-translated, .ytc-translating")) continue;
      const existingError = el.querySelector(".ytc-translate-error");
      if (existingError) existingError.remove();

      const text = extractMessageText(el);
      if (shouldSkip(text)) {
        translatedSet.add(el);
        continue;
      }

      pending.push({ el, text });
    }
    return pending;
  }

  async function translateVisibleMessages(target) {
    if (translatingInProgress) return;
    translatingInProgress = true;
    const gen = ++translateGeneration;

    try {
      const allPending = [];
      if (target === "chat" || !target) {
        const items = findChatContainer();
        if (items) allPending.push(...collectUntranslated(items, SELECTORS.liveChat));
      }
      if (target === "comments" || !target) {
        const commentRoot = document.querySelector("ytd-comments #contents") || document;
        allPending.push(...collectUntranslated(commentRoot, SELECTORS.comments));
      }

      if (allPending.length === 0) {
        updateTranslateVisibleBtn(null, "翻訳済み");
        setTimeout(() => updateTranslateVisibleBtn(null, null), 1500);
        return;
      }

      const total = allPending.length;
      let done = 0;

      const chunkSize = getBatchChunkSize();
      for (let start = 0; start < total; start += chunkSize) {
        if (gen !== translateGeneration) break;
        const chunk = allPending.slice(start, start + chunkSize);

        for (const item of chunk) {
          processingSet.add(item.el);
          const spinner = item.el.ownerDocument.createElement("span");
          spinner.className = "ytc-translating";
          spinner.textContent = "翻訳中...";
          item.el.appendChild(spinner);
          item.spinner = spinner;
        }

        updateTranslateVisibleBtn(null, `翻訳中 ${done}/${total}`);

        try {
          const texts = chunk.map((p) => p.text);
          const results = await translateBatch(texts);
          if (!Array.isArray(results)) throw new Error("翻訳結果の形式が不正です");

          for (let i = 0; i < chunk.length; i++) {
            const { el, text, spinner } = chunk[i];
            processingSet.delete(el);
            const translated = results[i]?.translatedText;
            if (!translated || translated.trim() === text.trim()) {
              const count = (failMap.get(el) || 0) + 1;
              failMap.set(el, count);
              if (count >= FAIL_MAX) translatedSet.add(el);
              if (spinner.parentNode) spinner.remove();
            } else {
              translatedSet.add(el);
              spinner.className = "ytc-translated";
              spinner.textContent = translated;
            }
          }
        } catch (e) {
          const errorMsg = e.message || "Unknown error";
          for (const { el, spinner } of chunk) {
            processingSet.delete(el);
            if (spinner.parentNode) {
              spinner.className = "ytc-translate-error";
              spinner.textContent = `⚠ ${errorMsg}`;
            }
          }
        }

        done += chunk.length;
      }

      updateTranslateVisibleBtn(null, `完了 ${done}件`);
      setTimeout(() => updateTranslateVisibleBtn(null, null), 2000);
    } finally {
      translatingInProgress = false;
    }
  }

  // --- 自動翻訳タイマー ---
  let chatAutoCountdown = null;
  let chatAutoGeneration = 0;
  const getChatAutoInterval = Base.createStorageValue("chatAutoInterval", 0, () => {
    // スライダー変更時: 自動モード中なら新しい間隔でカウントダウンを再起動
    if (!App.state.chatAutoEnabled) return;
    if (getChatAutoInterval() === 0) {
      App.state.chatAutoEnabled = false;
      stopChatAutoCountdown();
      syncAutoSwitch();
    } else {
      startChatAutoCountdown();
    }
  });

  function findChatEl(id) {
    return App.findInMainOrChat(`#${id}`);
  }

  function stopChatAutoCountdown() {
    chatAutoGeneration++;
    if (chatAutoCountdown) { clearInterval(chatAutoCountdown); chatAutoCountdown = null; }
    const btn = findChatEl("ytc-translate-visible-btn");
    if (btn && !btn.disabled) btn.textContent = "コメントを翻訳";
  }

  function startChatAutoCountdown() {
    stopChatAutoCountdown();
    const gen = chatAutoGeneration;
    let remaining = getChatAutoInterval();
    const updateLabel = () => {
      const btn = findChatEl("ytc-translate-visible-btn");
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = `自動翻訳 ${remaining}s`;
    };
    updateLabel();
    chatAutoCountdown = setInterval(() => {
      if (translatingInProgress) {
        const btn = findChatEl("ytc-translate-visible-btn");
        if (btn) btn.textContent = "翻訳中...";
        return;
      }
      remaining--;
      updateLabel();
      if (remaining <= 0) {
        translateVisibleMessages("chat").then(() => {
          if (gen === chatAutoGeneration && App.state.chatAutoEnabled) startChatAutoCountdown();
        });
      }
    }, COUNTDOWN_INTERVAL_MS);
  }

  function syncAutoSwitch() {
    const btn = findChatEl("ytc-translate-visible-btn");
    if (!btn) return;
    btn.classList.toggle("ytc-auto-on", App.state.chatAutoEnabled);
    if (!App.state.chatAutoEnabled && !btn.disabled) btn.textContent = "コメントを翻訳";
  }

  function setupTranslateVisibleBtn(doc) {
    if (!App.state.chatTranslateEnabled || !Base.isTranslationAvailable(App.state.chatModel, App.state.apiKeyConfigured)) {
      App.state.chatAutoEnabled = false;
      stopChatAutoCountdown();
      const existing = doc.querySelector("#ytc-chat-translate-bar");
      if (existing) existing.remove();
      return;
    }
    if (doc.querySelector("#ytc-chat-translate-bar")) return;

    const renderer = doc.querySelector("yt-live-chat-renderer");
    if (!renderer) return;
    const header = renderer.querySelector("#chat-messages");
    if (!header) return;

    const bar = doc.createElement("div");
    bar.id = "ytc-chat-translate-bar";
    bar.className = "ytc-chat-translate-bar";
    const btn = doc.createElement("button");
    btn.id = "ytc-translate-visible-btn";
    btn.className = "ytc-translate-visible-btn";
    btn.title = "クリック: 翻訳＋自動切替";
    btn.textContent = "コメントを翻訳";
    bar.appendChild(btn);
    header.insertBefore(bar, header.firstChild);

    btn.onclick = () => {
      if (getChatAutoInterval() === 0) {
        // 手動翻訳のみ
        translateVisibleMessages("chat");
        return;
      }
      App.state.chatAutoEnabled = !App.state.chatAutoEnabled;
      syncAutoSwitch();
      if (App.state.chatAutoEnabled) {
        translateVisibleMessages("chat");
        startChatAutoCountdown();
      } else {
        stopChatAutoCountdown();
      }
    };
  }

  function updateTranslateVisibleBtn(btn, text) {
    const candidates = [
      App.findInMainOrChat("#ytc-translate-visible-btn"),
      document.querySelector("#ytc-translate-visible-btn-comment"),
    ];

    for (const b of candidates) {
      if (!b) continue;
      if (text) {
        b.textContent = text;
        b.disabled = text.startsWith("翻訳中") || text === "翻訳済み";
      } else {
        b.disabled = false;
        if (b.id === "ytc-translate-visible-btn") {
          if (!App.state.chatAutoEnabled) b.textContent = "コメントを翻訳";
        } else {
          b.textContent = "コメントを翻訳";
        }
      }
    }
  }

  function findChatContainer() {
    return App.findInMainOrChat("yt-live-chat-renderer #items");
  }

  // --- コメント並び替え検知（ソート変更時に翻訳表示をクリア） ---
  let lastCommentOrder = null;

  function checkCommentReorder() {
    const commentEls = document.querySelectorAll(SELECTORS.comments);
    if (commentEls.length === 0) return;
    const order = [];
    for (let i = 0; i < Math.min(commentEls.length, 5); i++) {
      order.push(extractMessageText(commentEls[i]).slice(0, 30));
    }
    const key = order.join("|");
    if (lastCommentOrder !== null && lastCommentOrder !== key) {
      // 並び替え検知 — 翻訳表示をクリア
      for (const el of commentEls) {
        const translated = el.querySelector(".ytc-translated");
        if (translated) translated.remove();
        translatedSet.delete(el);
      }
    }
    lastCommentOrder = key;
  }

  // --- 投票バナー翻訳 ---
  const POLL_BTN_ID = "ytc-poll-translate-btn";

  function setupPollTranslateBtn() {
    if (Base.sttLang === "ja-JP" || !Base.isTranslationAvailable(App.state.chatModel, App.state.apiKeyConfigured)) {
      const existing = App.findInMainOrChat("#" + POLL_BTN_ID);
      if (existing) existing.remove();
      return;
    }
    const banner = App.findInMainOrChat("yt-live-chat-banner-poll-renderer");
    if (!banner) return;
    const doc = banner.ownerDocument;
    if (doc.getElementById(POLL_BTN_ID)) return;

    const question = banner.querySelector("#poll-question");
    const choices = banner.querySelectorAll("yt-live-chat-banner-poll-choice #label-text");
    if (!question && choices.length === 0) return;

    const btn = doc.createElement("button");
    btn.id = POLL_BTN_ID;
    btn.className = "ytc-poll-translate-btn";
    btn.textContent = "翻訳";
    let translated = false;

    btn.onclick = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const renderer = banner.closest("yt-live-chat-banner-renderer");
      if (renderer && renderer.hasAttribute("collapsed")) renderer.click();
      if (translated) {
        // 原文に戻す
        if (question && question.dataset.original) question.textContent = question.dataset.original;
        choices.forEach(c => { if (c.dataset.original) c.textContent = c.dataset.original; });
        btn.textContent = "翻訳";
        translated = false;
        return;
      }
      btn.disabled = true;
      btn.textContent = "⏳";
      try {
        const texts = [];
        if (question) texts.push(question.textContent.trim());
        choices.forEach(c => texts.push(c.textContent.trim()));

        const res = await Base.translate.batch(texts);
        if (!Array.isArray(res.results)) throw new Error("翻訳結果の形式が不正です");

        let idx = 0;
        if (question) {
          question.dataset.original = question.textContent;
          question.textContent = res.results[idx].translatedText || question.textContent;
          idx++;
        }
        choices.forEach(c => {
          c.dataset.original = c.textContent;
          c.textContent = res.results[idx]?.translatedText || c.textContent;
          idx++;
        });
        btn.textContent = "原文";
        translated = true;
      } catch {
        btn.textContent = "翻訳";
      } finally {
        btn.disabled = false;
      }
    };

    const header = banner.querySelector("#content-top");
    if (header) {
      header.appendChild(btn);
    }
  }

  const log = Base.log.create("chat");

  /** @returns {Document|null} チャットコンテナの ownerDocument（未検出時 null） */
  function pollChat() {
    const items = findChatContainer();
    if (items) {
      try { setupTranslateVisibleBtn(items.ownerDocument); } catch (e) { log.warn("setupTranslateVisibleBtn", e); }
    }
    try { checkCommentReorder(); } catch (e) { log.warn("checkCommentReorder", e); }
    try { setupPollTranslateBtn(); } catch (e) { log.warn("setupPollTranslateBtn", e); }
    return items ? items.ownerDocument : null;
  }

  function resetTranslations() {
    translateGeneration++;
    translatedSet = new WeakSet();
    processingSet = new WeakSet();
    failMap = new WeakMap();
    for (const sel of [".ytc-translated", ".ytc-translating", ".ytc-translate-error"]) {
      const chatContainer = findChatContainer();
      if (chatContainer) chatContainer.querySelectorAll(sel).forEach((el) => el.remove());
      document.querySelectorAll(sel).forEach((el) => el.remove());
    }
  }

  App.chat = {
    pollChat,
    translateVisibleMessages,
    resetTranslations,
  };
})(UbyeApp, UbyeBase);
