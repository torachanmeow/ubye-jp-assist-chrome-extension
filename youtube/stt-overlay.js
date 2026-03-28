// STT ログビューア。認識結果の蓄積・翻訳リクエスト・原文/翻訳切替・自動翻訳制御。
(function (App, Base) {
  const MSG = Base.MSG;
  const SCROLL_THRESHOLD = 80;
  const OVERLAY_INITIAL_WIDTH = 500;
  const OVERLAY_INITIAL_HEIGHT = 200;

  function needsTranslation() {
    return Base.sttLang !== "ja-JP" && App.state.apiKeyConfigured;
  }

  const getMaxDisplay = Base.createStorageValue("sttMaxLines", undefined, () => applyDisplayLimit());

  function applyDisplayLimit() {
    const linesEl = document.getElementById("ubye-stt-lines");
    if (!linesEl) return;
    const children = linesEl.children;
    // 表示行数を超えた古い行を非表示、範囲内を表示
    for (let i = 0; i < children.length; i++) {
      const show = i >= children.length - getMaxDisplay();
      children[i].style.display = show ? "" : "none";
    }
  }

  function syncAutoTranslateBtn() {
    const btn = document.getElementById("ubye-stt-auto-translate");
    if (!btn) return;
    if (!needsTranslation()) {
      btn.style.display = "none";
      return;
    }
    btn.style.display = "";
    btn.classList.toggle("ubye-stt-btn-active", App.state.speechAutoTranslate);
    btn.title = "自動翻訳 ON/OFF";
  }

  const getSpeechModel = Base.createStorageValue("speechModel", Base.DEFAULT_GEMINI_MODEL, () => syncTitle());

  function shortModelName(value) {
    return value.replace(/^gemini-/, "").replace(/-preview$/, "");
  }

  function buildTitle() {
    const model = getSpeechModel() ? " / " + shortModelName(getSpeechModel()) : "";
    return "ログビューア (" + (Base.sttLang || "?") + model + ")";
  }

  function createSttOverlay() {
    if (document.getElementById("ubye-stt-overlay")) return;

    const headerExtra = document.createElement("button");
    headerExtra.id = "ubye-stt-auto-translate";
    headerExtra.title = "自動翻訳 ON/OFF";
    headerExtra.textContent = "自動翻訳";

    const bodyContent = document.createDocumentFragment();
    const linesDiv = document.createElement("div");
    linesDiv.id = "ubye-stt-lines";
    bodyContent.appendChild(linesDiv);
    const interimDiv = document.createElement("div");
    interimDiv.id = "ubye-stt-interim";
    bodyContent.appendChild(interimDiv);

    const overlay = Base.createOverlayPanel({
      id: "ubye-stt-overlay",
      title: buildTitle(),
      initialSize: { width: OVERLAY_INITIAL_WIDTH, height: OVERLAY_INITIAL_HEIGHT },
      headerExtra,
      bodyContent,
      onClose() {
        // DOMを削除せず非表示にする
        const ov = document.getElementById("ubye-stt-overlay");
        if (ov) ov.style.setProperty("display", "none", "important");
        chrome.storage.local.set({ sttLogVisible: false });
        return false; // overlay.jsのremoveを抑制
      },
    });

    const autoTransBtn = overlay.querySelector("#ubye-stt-auto-translate");
    syncAutoTranslateBtn();
    autoTransBtn.onclick = () => {
      App.state.speechAutoTranslate = !App.state.speechAutoTranslate;
      chrome.storage.local.set({ speechAutoTranslate: App.state.speechAutoTranslate });
      // syncAutoTranslateBtn は storage change listener 経由で呼ばれる
    };

    chrome.runtime.sendMessage({ type: MSG.STT_CMD, cmd: "get-status" });
  }

  function createBtn(className, title, text, onClick) {
    const btn = document.createElement("span");
    btn.className = className;
    btn.title = title;
    btn.textContent = text;
    btn.onclick = (e) => { e.stopPropagation(); onClick(); };
    return btn;
  }

  function setErrorView(el, text, line, errorMsg) {
    el.textContent = "";
    const origSpan = document.createElement("span");
    origSpan.className = "ubye-stt-original";
    origSpan.textContent = text;
    el.appendChild(origSpan);
    el.appendChild(document.createTextNode(" "));
    if (errorMsg) {
      const errSpan = document.createElement("span");
      errSpan.className = "ubye-stt-error-msg";
      errSpan.textContent = errorMsg;
      el.appendChild(errSpan);
      el.appendChild(document.createTextNode(" "));
    }
    el.appendChild(createBtn("ubye-stt-translate-btn", "翻訳", "翻訳", () => retrySttTranslation(line)));
  }

  function setTranslatedView(el, line) {
    let showingOriginal = false;
    el.textContent = "";
    el.className = "ubye-stt-line ubye-stt-translated";
    el.style.cursor = "pointer";
    el.title = "クリックで原文表示";
    const textNode = document.createTextNode(line.translation);
    el.appendChild(textNode);
    el.appendChild(createBtn("ubye-stt-retranslate-btn", "再翻訳", "再翻訳", () => retrySttTranslation(line)));
    el.onclick = (e) => {
      if (e.target.classList.contains("ubye-stt-retranslate-btn")) return;
      showingOriginal = !showingOriginal;
      textNode.textContent = showingOriginal ? line.text : line.translation;
      el.title = showingOriginal ? "クリックで翻訳表示" : "クリックで原文表示";
    };
  }

  function appendSttLine(container, line) {
    const div = document.createElement("div");
    div.className = "ubye-stt-line";
    div.dataset.id = line.id;

    if (line.status === "done" && line.translation) {
      setTranslatedView(div, line);
    } else if (line.status === "error") {
      setErrorView(div, line.text, line, line.translation);
    } else if (line.status === "idle") {
      div.textContent = line.text;
      div.appendChild(createBtn("ubye-stt-translate-btn", "翻訳", "翻訳", () => retrySttTranslation(line)));
      div.classList.add("ubye-stt-idle");
    } else if (line.status === "no-translate") {
      div.textContent = line.text;
    } else {
      div.textContent = line.text;
      div.classList.add("ubye-stt-pending");
    }
    container.appendChild(div);
  }

  let onTranslated = null;

  function requestSttTranslation(text, line, updateSubtitle) {
    Base.sendMsg({ type: MSG.TRANSLATE_SPEECH, text }).then((res) => {
      line.translation = res.translatedText;
      line.status = "done";
    }, (e) => {
      line.translation = e.message || "翻訳エラー";
      line.status = "error";
    }).then(() => {
      sttUpdateTranslated(line.id, line.translation, line.status);
      if (updateSubtitle && onTranslated) onTranslated(line.id, line.translation, line.status);
    });
  }

  function retrySttTranslation(line) {
    const el = document.querySelector(`.ubye-stt-line[data-id="${CSS.escape(line.id)}"]`);
    if (!el) return;
    el.classList.remove("ubye-stt-idle");
    el.classList.add("ubye-stt-pending");
    el.textContent = line.text;
    el.style.cursor = "";
    el.title = "";
    el.onclick = null;
    line.status = "translating";
    line.translation = null;
    requestSttTranslation(line.text, line, false);
  }

  function sttUpdateTranslated(id, translation, status) {
    const el = document.querySelector(`.ubye-stt-line[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.classList.remove("ubye-stt-pending", "ubye-stt-idle");
    const line = sttLines.get(id);
    if (status === "done" && translation) {
      if (line) {
        setTranslatedView(el, line);
      } else {
        el.textContent = translation;
        el.classList.add("ubye-stt-translated");
      }
    } else {
      const orig = line ? line.text : el.textContent;
      setErrorView(el, orig, line, translation);
    }
  }

  function sttUpdateStatus(status) {
    const dot = document.querySelector("#ubye-stt-overlay .ubye-overlay-status-dot");
    if (!dot) return;
    const active = status === "listening" || status === "starting";
    dot.className = active ? "ubye-overlay-status-dot ubye-stt-dot-active" : "ubye-overlay-status-dot ubye-stt-dot-idle";
    if (!active) {
      const interimEl = document.getElementById("ubye-stt-interim");
      if (interimEl) interimEl.textContent = "";
    }
  }

  function scrollSttToBottom() {
    const body = document.querySelector("#ubye-stt-overlay .ubye-overlay-body");
    if (!body) return;
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < SCROLL_THRESHOLD;
    if (atBottom) body.scrollTop = body.scrollHeight;
  }

  const sttLines = new Map();

  function handleInterim(msg) {
    const el = document.getElementById("ubye-stt-interim");
    if (!el) return;
    const raw = msg.text || "";
    el.textContent = Base.applyS2T(raw);
    scrollSttToBottom();
  }

  function handleFinal(msg) {
    const linesEl = document.getElementById("ubye-stt-lines");
    if (!linesEl) return;

    const id = crypto.randomUUID();
    msg._sttLineId = id;
    const translate = needsTranslation();
    const status = translate ? (App.state.speechAutoTranslate ? "translating" : "idle") : "no-translate";
    const displayText = Base.applyS2T(msg.text);
    const line = { id, text: displayText, translation: null, status };
    sttLines.set(id, line);
    appendSttLine(linesEl, line);
    const interimEl = document.getElementById("ubye-stt-interim");
    if (interimEl) interimEl.textContent = "";
    const max = getMaxDisplay();
    while (sttLines.size > max) {
      sttLines.delete(sttLines.keys().next().value);
      if (linesEl.firstChild) linesEl.removeChild(linesEl.firstChild);
    }
    applyDisplayLimit();
    scrollSttToBottom();

    if (translate && App.state.speechAutoTranslate) {
      requestSttTranslation(msg.text, line, true);
    }
  }

  const broadcastHandlers = {
    status: (msg) => sttUpdateStatus(msg.status),
    interim: handleInterim,
    final: handleFinal,
  };

  function handleSttBroadcast(msg) {
    const handler = broadcastHandlers[msg.subtype];
    if (handler) handler(msg);
  }

  function syncTranslateButtons() {
    const linesEl = document.getElementById("ubye-stt-lines");
    if (!linesEl) return;
    const translate = needsTranslation();
    for (const line of sttLines.values()) {
      if (line.status === "done" || line.status === "translating" || line.status === "pending") continue;
      const el = linesEl.querySelector(`.ubye-stt-line[data-id="${CSS.escape(line.id)}"]`);
      if (!el) continue;
      line.status = translate ? "idle" : "no-translate";
      el.textContent = line.text;
      el.className = "ubye-stt-line" + (translate ? " ubye-stt-idle" : "");
      if (translate) {
        el.appendChild(createBtn("ubye-stt-translate-btn", "翻訳", "翻訳", () => retrySttTranslation(line)));
      }
    }
  }

  function clearLog() {
    sttLines.clear();
    const linesEl = document.getElementById("ubye-stt-lines");
    if (linesEl) linesEl.replaceChildren();
    const interimEl = document.getElementById("ubye-stt-interim");
    if (interimEl) interimEl.textContent = "";
  }

  function syncTitle() {
    const titleEl = document.querySelector("#ubye-stt-overlay .ubye-overlay-title");
    if (titleEl) titleEl.textContent = buildTitle();
  }

  App.sttOverlay = {
    create: createSttOverlay,
    handleBroadcast: handleSttBroadcast,
    syncAutoTranslateBtn,
    syncTranslateButtons,
    syncTitle,
    clearLog,
    setOnTranslated(cb) { onTranslated = cb; },
  };
})(UbyeApp, UbyeBase);
