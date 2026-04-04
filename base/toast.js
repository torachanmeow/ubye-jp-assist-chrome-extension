// 画面中央にトースト通知を表示するユーティリティ。
(function (Base) {
  if (Base.showToast) return; // 動的注入の冪等性ガード
  const TOAST_DISPLAY_MS = 4000;
  let toastEl = null;
  let toastTimer = null;

  Base.showToast = function (text, hint) {
    if (window !== window.top) return;
    if (toastEl) toastEl.remove();
    toastEl = document.createElement("div");
    toastEl.id = "ubye-toast";
    toastEl.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;background:rgba(0,0,0,0.85);color:#fff;font-size:14px;padding:20px 36px;border-radius:10px;text-align:center;line-height:1.8;pointer-events:none;transition:opacity 0.3s";
    document.body.appendChild(toastEl);
    toastEl.textContent = text;
    if (hint) {
      toastEl.appendChild(document.createElement("br"));
      const hintSpan = document.createElement("span");
      hintSpan.style.cssText = "color:#e0c97f;font-size:12px";
      hintSpan.textContent = hint;
      toastEl.appendChild(hintSpan);
    }
    toastEl.style.opacity = "1";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = "0";
      toastTimer = null;
    }, TOAST_DISPLAY_MS);
  };
})(UbyeBase);
