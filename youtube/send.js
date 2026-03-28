// 送信アシスト。チャット・スパチャ・コメント入力欄に翻訳ボタンを注入。
(function (App, Base) {
  const sendMsg = Base.sendMsg;
  const setInputText = App.setInputText;
  const MSG = Base.MSG;

  const inputStateMap = new WeakMap();

  function translateSend(text) {
    return sendMsg({ type: MSG.TRANSLATE_SEND, text }).then((res) => res.translatedText);
  }

  function createTranslateButton(doc, inputEl) {
    const prev = inputStateMap.get(inputEl);
    if (prev) prev.cleanup();

    const btn = doc.createElement("button");
    btn.className = "ytc-send-btn";
    btn.textContent = Base.sendLabel;
    btn.title = "翻訳して入力欄にセット";

    let originalText = null;
    let ignoreNextInput = false;

    const onInput = () => {
      if (ignoreNextInput) { ignoreNextInput = false; return; }
      if (originalText !== null) {
        originalText = null;
        btn.classList.remove("ytc-send-active");
      }
    };
    inputEl.addEventListener("input", onInput);

    const onClick = async () => {
      const text = inputEl.textContent.trim();
      if (!text) return;
      if (originalText !== null) {
        ignoreNextInput = true;
        setInputText(inputEl, originalText);
        originalText = null;
        btn.classList.remove("ytc-send-active");
        return;
      }
      btn.disabled = true;
      btn.textContent = "⏳";
      try {
        originalText = text;
        ignoreNextInput = true;
        const translated = await translateSend(text);
        ignoreNextInput = true;
        setInputText(inputEl, translated);
        btn.classList.add("ytc-send-active");
      } catch {
        originalText = null;
      } finally {
        btn.disabled = false;
        btn.textContent = Base.sendLabel;
      }
    };
    btn.addEventListener("click", onClick);

    const state = {
      btn,
      observer: null,
      cleanup() {
        inputEl.removeEventListener("input", onInput);
        btn.removeEventListener("click", onClick);
        if (state.observer) { state.observer.disconnect(); state.observer = null; }
        if (btn.isConnected) btn.remove();
        inputStateMap.delete(inputEl);
      },
    };
    btn._ytcCleanup = state.cleanup;
    inputStateMap.set(inputEl, state);
    return state;
  }

  function withTwEnabled(doc, selector, insertFn) {
    if (!App.state.sendEnabled || Base.sttLang === "ja-JP" || !App.state.apiKeyConfigured) {
      const existing = doc.querySelector(selector);
      if (existing) {
        if (existing._ytcCleanup) existing._ytcCleanup();
        else existing.remove();
      }
      return;
    }
    insertFn(doc);
  }

  function setupChatButton(doc) {
    withTwEnabled(doc, "#ytc-send-btn", insertChatButton);
  }

  function insertChatButton(doc) {
    if (doc.querySelector("#ytc-send-btn")) return;
    const inputRenderer = doc.querySelector("yt-live-chat-message-input-renderer");
    if (!inputRenderer) return;
    const sendBtn = inputRenderer.querySelector("#send-button");
    if (!sendBtn) return;
    const inputEl = inputRenderer.querySelector("yt-live-chat-text-input-field-renderer #input");
    if (!inputEl) return;

    const state = createTranslateButton(doc, inputEl);
    state.btn.id = "ytc-send-btn";
    state.btn.hidden = sendBtn.hidden;
    const observer = new MutationObserver(() => { state.btn.hidden = sendBtn.hidden; });
    observer.observe(sendBtn, { attributes: true, attributeFilter: ["hidden"] });
    state.observer = observer;

    const emojiBtn = inputRenderer.querySelector("#emoji-picker-button");
    if (emojiBtn) {
      emojiBtn.parentNode.insertBefore(state.btn, emojiBtn.nextSibling);
    } else {
      sendBtn.parentNode.insertBefore(state.btn, sendBtn);
    }
  }

  function setupSuperChatButton(doc) {
    withTwEnabled(doc, "#ytc-send-btn-sc", insertSuperChatButton);
  }

  function insertSuperChatButton(doc) {
    if (doc.querySelector("#ytc-send-btn-sc")) return;
    const buyFlow = doc.querySelector("yt-live-chat-message-buy-flow-renderer");
    if (!buyFlow) return;
    const inputEl = buyFlow.querySelector("yt-live-chat-paid-message-renderer #input-field #input");
    if (!inputEl) return;
    const pickerButtons = buyFlow.querySelector("#picker-buttons");
    if (!pickerButtons) return;
    const state = createTranslateButton(doc, inputEl);
    state.btn.id = "ytc-send-btn-sc";
    pickerButtons.appendChild(state.btn);
  }

  function setupCommentButton(doc) {
    withTwEnabled(doc, "#ytc-send-btn-comment", insertCommentButton);
  }

  function insertCommentButton(doc) {
    if (doc.querySelector("#ytc-send-btn-comment")) return;
    const commentbox = doc.querySelector("ytd-commentbox");
    if (!commentbox) return;
    const inputEl = commentbox.querySelector("#contenteditable-root");
    if (!inputEl) return;
    const emojiBtn = commentbox.querySelector("#emoji-button");
    if (!emojiBtn) return;
    const state = createTranslateButton(doc, inputEl);
    state.btn.id = "ytc-send-btn-comment";
    emojiBtn.parentNode.insertBefore(state.btn, emojiBtn.nextSibling);
  }

  function removeAllButtons(doc) {
    doc.querySelectorAll(".ytc-send-btn").forEach((btn) => {
      if (btn._ytcCleanup) btn._ytcCleanup();
      else btn.remove();
    });
  }

  App.send = {
    setupChatButton,
    setupSuperChatButton,
    setupCommentButton,
    removeAllButtons,
  };
})(UbyeApp, UbyeBase);
