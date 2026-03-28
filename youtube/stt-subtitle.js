// STT 字幕表示。プレイヤー下部にフェード付き字幕を表示し、YouTube 字幕との位置調整を行う。
(function (App, Base) {
  const MSG = Base.MSG;
  const PLAYER_RETRY_INTERVAL = 500;
  const PLAYER_RETRY_TIMEOUT = 5000;
  const FADE_ANIMATION_MS = 500;

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

  function isShorts() {
    return location.pathname.startsWith("/shorts/");
  }

  function findPlayer() {
    if (isShorts()) {
      return document.querySelector("ytd-reel-video-renderer #player-container")
        || document.querySelector("#shorts-inner-container")
        || document.querySelector("ytd-shorts");
    }
    return document.querySelector("#movie_player");
  }

  let captionStyleEl = null;

  function hideYouTubeCaptions() {
    if (captionStyleEl) return;
    captionStyleEl = document.createElement("style");
    captionStyleEl.textContent = ".caption-window { display: none !important; }";
    document.head.appendChild(captionStyleEl);
  }

  function restoreYouTubeCaptions() {
    if (captionStyleEl) { captionStyleEl.remove(); captionStyleEl = null; }
  }

  function create() {
    if (containerEl) return;
    const player = findPlayer();
    if (!player) {
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      retryTimer = setInterval(() => {
        if (findPlayer()) { clearInterval(retryTimer); retryTimer = null; create(); }
      }, PLAYER_RETRY_INTERVAL);
      setTimeout(() => { if (retryTimer) { clearInterval(retryTimer); retryTimer = null; } }, PLAYER_RETRY_TIMEOUT);
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
    player.appendChild(containerEl);

    chrome.storage.local.get({ subtitleFontSize: Base.DEFAULTS.subtitleFontSize }, (cfg) => {
      if (containerEl) containerEl.style.fontSize = cfg.subtitleFontSize + "px";
    });

    hideYouTubeCaptions();
  }

  function destroy() {
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    restoreYouTubeCaptions();
    if (containerEl) { containerEl.remove(); containerEl = null; }
    if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
    if (errorEl) { errorEl.remove(); errorEl = null; }
    pendingLines.length = 0;
  }

  function startFadeTimer(el) {
    if (el._fadeTimer) clearTimeout(el._fadeTimer);
    el._fadeTimer = setTimeout(() => {
      el.classList.add("ubye-subtitle-fade");
      setTimeout(() => { if (el.parentNode) el.remove(); }, FADE_ANIMATION_MS);
    }, getFadeTime() * 1000);
  }

  function resetAllFadeTimers() {
    const linesEl = containerEl?.querySelector("#ubye-subtitle-lines");
    if (!linesEl) return;
    for (const el of linesEl.children) {
      if (el.classList.contains("ubye-subtitle-fade")) continue;
      startFadeTimer(el);
    }
  }

  function addLine(text) {
    const linesEl = containerEl?.querySelector("#ubye-subtitle-lines");
    if (!linesEl) return null;

    const div = document.createElement("div");
    div.className = "ubye-subtitle-line";
    div.style.cssText = "background:" + bgColor() + ";color:#fff;padding:6px 16px;border-radius:4px;text-shadow:0 1px 3px rgba(0,0,0,0.8);line-height:1.4;display:block";
    div.textContent = text;
    linesEl.appendChild(div);

    startFadeTimer(div);
    return div;
  }

  const ERROR_DISPLAY_MS = 5000;
  let errorEl = null;
  let errorTimer = null;

  function showError(message) {
    const player = findPlayer();
    if (!player) return;
    if (!errorEl) {
      errorEl = document.createElement("div");
      errorEl.id = "ubye-subtitle-error";
      errorEl.style.cssText = "position:absolute;top:8px;left:8px;z-index:61;background:rgba(200,50,50,0.9);color:#fff;font-size:13px;padding:4px 12px;border-radius:4px;pointer-events:none;transition:opacity 0.3s";
      player.appendChild(errorEl);
    }
    errorEl.textContent = message;
    errorEl.style.opacity = "1";
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
      if (errorEl) errorEl.style.opacity = "0";
      errorTimer = null;
    }, ERROR_DISPLAY_MS);
  }

  function handleBroadcast(msg) {
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
      const lineEl = addLine(displayText);
      if (!lineEl) return;
      for (let i = pendingLines.length - 1; i >= 0; i--) {
        if (!pendingLines[i].el.parentNode) pendingLines.splice(i, 1);
      }
      pendingLines.push({ id: msg._sttLineId, el: lineEl });
    }
  }

  const pendingLines = [];

  /** ログビューアから翻訳結果を受け取って字幕に反映 */
  function applyTranslation(id, translatedText, status) {
    const idx = pendingLines.findIndex((entry) => entry.id === id);
    if (idx === -1) return;
    const { el: lineEl } = pendingLines[idx];
    pendingLines.splice(idx, 1);
    if (status === "done" && lineEl.parentNode) {
      lineEl.textContent = translatedText;
      lineEl.style.color = "#fff";
      startFadeTimer(lineEl);
    }
  }

  App.sttSubtitle = { create, destroy, handleBroadcast, applyTranslation };
})(UbyeApp, UbyeBase);
