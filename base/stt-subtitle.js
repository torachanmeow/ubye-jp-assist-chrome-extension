// STT 字幕表示の共通ロジック。フェード制御、翻訳反映、エラー表示を提供する。
(function (Base) {
  if (Base.setupSttSubtitle) return; // 動的注入の冪等性ガード
  const FADE_ANIMATION_MS = 500;
  const ERROR_DISPLAY_MS = 5000;

  /**
   * STT 字幕コンポーネントを生成する。
   * @param {object} opts
   * @param {function} opts.findParent - 字幕コンテナの親要素を返す（null なら未準備）
   * @param {number} [opts.retryInterval] - findParent リトライ間隔 ms（省略時リトライなし）
   * @param {number} [opts.retryTimeout] - リトライ最大待機 ms
   * @param {function} [opts.onMount] - コンテナ挿入後のコールバック
   * @param {function} [opts.onUnmount] - コンテナ削除時のコールバック
   * @param {string} opts.errorCss - エラー要素の style.cssText
   * @param {function} opts.mountError - エラー要素を DOM に挿入する関数
   * @returns {{ create, destroy, handleBroadcast, applyTranslation }}
   */
  Base.setupSttSubtitle = function (opts) {
    const getFadeTime = Base.createStorageValue("subtitleFadeTime", undefined, () => resetAllFadeTimers());
    const getBgOpacity = Base.createStorageValue("sttBgOpacity", undefined, () => updateSubtitleBg());

    function bgColor() { return "rgba(" + Base.STT_BG_RGB + "," + getBgOpacity() + ")"; }

    function updateSubtitleBg() {
      const linesEl = containerEl?.querySelector("#ubye-subtitle-lines");
      if (linesEl) {
        for (const el of linesEl.children) el.style.background = bgColor();
      }
      const interimEl = containerEl?.querySelector("#ubye-subtitle-interim");
      if (interimEl) interimEl.style.background = bgColor();
    }

    let containerEl = null;
    let retryTimer = null;
    let retryTimeoutTimer = null;

    function create() {
      if (containerEl) return;
      const parent = opts.findParent();
      if (!parent) {
        if (!opts.retryInterval || retryTimer) return;
        retryTimer = setInterval(() => {
          if (opts.findParent()) {
            clearInterval(retryTimer); retryTimer = null;
            clearTimeout(retryTimeoutTimer); retryTimeoutTimer = null;
            create();
          }
        }, opts.retryInterval);
        retryTimeoutTimer = setTimeout(() => {
          if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
          retryTimeoutTimer = null;
        }, opts.retryTimeout);
        return;
      }

      containerEl = document.createElement("div");
      containerEl.id = "ubye-stt-subtitle-dock";

      const linesEl = document.createElement("div");
      linesEl.id = "ubye-subtitle-lines";
      containerEl.appendChild(linesEl);
      const interimEl = document.createElement("div");
      interimEl.id = "ubye-subtitle-interim";
      interimEl.style.cssText = "background:" + bgColor() + ";color:#ffd54f;font-style:italic;padding:6px 16px;border-radius:4px;text-shadow:0 1px 3px rgba(0,0,0,0.8);display:none;margin-top:4px;max-width:90%;line-height:1.4;word-wrap:break-word";
      containerEl.appendChild(interimEl);
      parent.appendChild(containerEl);

      chrome.storage.local.get({ subtitleFontSize: Base.DEFAULTS.subtitleFontSize }, (cfg) => {
        if (containerEl) containerEl.style.fontSize = cfg.subtitleFontSize + "px";
      });

      if (opts.onMount) opts.onMount();
    }

    function destroy() {
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      if (retryTimeoutTimer) { clearTimeout(retryTimeoutTimer); retryTimeoutTimer = null; }
      if (opts.onUnmount) opts.onUnmount();
      if (containerEl) { containerEl.remove(); containerEl = null; }
      if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
      if (errorEl) { errorEl.remove(); errorEl = null; }
      pendingLines.length = 0;
    }

    function startFadeTimer(el, delayMs) {
      if (el._fadeTimer) clearTimeout(el._fadeTimer);
      const ms = (delayMs !== undefined) ? delayMs : getFadeTime() * 1000;
      el._fadeTimer = setTimeout(() => {
        el.classList.add("ubye-subtitle-fade");
        setTimeout(() => { if (el.parentNode) el.remove(); }, FADE_ANIMATION_MS);
      }, Math.max(0, ms));
    }

    function resetAllFadeTimers() {
      const linesEl = containerEl?.querySelector("#ubye-subtitle-lines");
      if (!linesEl) return;
      for (const el of linesEl.children) {
        if (el.classList.contains("ubye-subtitle-fade")) continue;
        startFadeTimer(el);
      }
    }

    function addLine(text, waitTranslation) {
      const linesEl = containerEl?.querySelector("#ubye-subtitle-lines");
      if (!linesEl) return null;

      const div = document.createElement("div");
      div.className = "ubye-subtitle-line";
      div.style.cssText = "background:" + bgColor() + ";color:#fff;padding:6px 16px;border-radius:4px;text-shadow:0 1px 3px rgba(0,0,0,0.8);line-height:1.4;display:block";
      div.textContent = text;
      linesEl.appendChild(div);

      if (!waitTranslation) startFadeTimer(div);
      return div;
    }

    let errorEl = null;
    let errorTimer = null;

    function showError(message) {
      if (!errorEl) {
        errorEl = document.createElement("div");
        errorEl.id = "ubye-subtitle-error";
        errorEl.style.cssText = opts.errorCss;
        opts.mountError(errorEl);
      }
      errorEl.textContent = message;
      errorEl.style.opacity = "1";
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = setTimeout(() => {
        if (errorEl) errorEl.style.opacity = "0";
        errorTimer = null;
      }, ERROR_DISPLAY_MS);
    }

    const pendingLines = [];

    function handleBroadcast(msg, lineId) {
      if (!containerEl) return;

      if (msg.subtype === "error" && msg.fatal) {
        showError("音声認識エラー: " + (msg.error || "不明"));
        return;
      }

      if (msg.subtype === "interim") {
        const el = containerEl.querySelector("#ubye-subtitle-interim");
        if (!el) return;
        const raw = msg.text || "";
        const text = Base.applyS2T(raw);
        el.textContent = text;
        el.style.display = text ? "" : "none";
        return;
      }

      if (msg.subtype === "final") {
        const interimEl = containerEl.querySelector("#ubye-subtitle-interim");
        if (interimEl) { interimEl.textContent = ""; interimEl.style.display = "none"; }

        const displayText = Base.applyS2T(msg.text);
        const waitTranslation = !!lineId;
        const lineEl = addLine(displayText, waitTranslation);
        if (!lineEl) return;
        if (waitTranslation) {
          for (let i = pendingLines.length - 1; i >= 0; i--) {
            if (!pendingLines[i].el.parentNode) pendingLines.splice(i, 1);
          }
          pendingLines.push({ id: lineId, el: lineEl });
        }
      }
    }

    function applyTranslation(id, translatedText, status) {
      const idx = pendingLines.findIndex((entry) => entry.id === id);
      if (idx === -1) return;
      const { el: lineEl } = pendingLines[idx];
      pendingLines.splice(idx, 1);
      if (!lineEl.parentNode) return;
      if (status === "done") {
        lineEl.textContent = translatedText;
        lineEl.style.color = "#fff";
      }
      lineEl.classList.remove("ubye-subtitle-fade");
      startFadeTimer(lineEl);
    }

    return { create, destroy, handleBroadcast, applyTranslation };
  };
})(UbyeBase);
