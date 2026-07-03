// STT 字幕（YouTube版）。プレイヤー下部にフェード付き字幕を表示し、YouTube 字幕との位置調整を行う。
(function (App, Base) {
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

  App.sttSubtitle = Base.setupSttSubtitle({
    findParent: findPlayer,
    retryInterval: 500,
    retryTimeout: 5000,
    onMount: hideYouTubeCaptions,
    onUnmount: restoreYouTubeCaptions,
    errorCss: "position:absolute;top:8px;left:8px;z-index:61;background:rgba(200,50,50,0.9);color:#fff;font-size:13px;padding:4px 12px;border-radius:4px;pointer-events:none;transition:opacity 0.3s",
    mountError: (el) => { const p = findPlayer(); if (p) p.appendChild(el); },
  });
})(UbyeApp, UbyeBase);
