// STT 字幕（汎用サイト版）。画面下部にフェード付き字幕をフロート表示する。
(function (App, Base) {
  App.sttSubtitle = Base.setupSttSubtitle({
    findParent: () => document.body,
    errorCss: "position:fixed;top:8px;left:8px;z-index:2147483647;background:rgba(200,50,50,0.9);color:#fff;font-size:13px;padding:4px 12px;border-radius:4px;pointer-events:none;transition:opacity 0.3s",
    mountError: (el) => document.body.appendChild(el),
  });
})(UbyeApp, UbyeBase);
