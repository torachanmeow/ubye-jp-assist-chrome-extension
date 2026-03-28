// 汎用のドラッグ・リサイズ・最小化パネル生成コンポーネント。
(function (Base) {
  /**
   * 汎用のドラッグ/リサイズ/最小化パネルを生成する。
   * @param {Object} options
   * @param {string} options.id - パネル要素の ID
   * @param {string} options.title - ヘッダーに表示するタイトル
   * @param {{ width: number, height: number }} options.initialSize
   * @param {HTMLElement|DocumentFragment} [options.headerExtra] - ヘッダー右側に挿入する DOM 要素
   * @param {HTMLElement|DocumentFragment} [options.bodyContent] - ボディ内の DOM 要素
   * @param {function} [options.onClose] - 閉じるボタンのコールバック。false を返すとパネル削除を中止する
   * @returns {HTMLElement} 生成されたオーバーレイ要素
   */
  Base.createOverlayPanel = function (options) {
    if (document.getElementById(options.id)) return document.getElementById(options.id);

    const overlay = document.createElement("div");
    overlay.id = options.id;
    const header = document.createElement("div");
    header.className = "ubye-overlay-header";
    const titleSpan = document.createElement("span");
    titleSpan.className = "ubye-overlay-title";
    titleSpan.textContent = options.title;
    header.appendChild(titleSpan);
    const dot = document.createElement("span");
    dot.className = "ubye-overlay-status-dot";
    header.appendChild(dot);
    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    header.appendChild(spacer);
    if (options.headerExtra) {
      header.appendChild(options.headerExtra);
    }
    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "ubye-overlay-minimize";
    minimizeBtn.title = "最小化";
    minimizeBtn.textContent = "\u2212";
    header.appendChild(minimizeBtn);
    const closeBtn = document.createElement("button");
    closeBtn.className = "ubye-overlay-close";
    closeBtn.title = "閉じる";
    closeBtn.textContent = "\u2715";
    header.appendChild(closeBtn);
    overlay.appendChild(header);
    const body = document.createElement("div");
    body.className = "ubye-overlay-body";
    if (options.bodyContent) {
      body.appendChild(options.bodyContent);
    }
    overlay.appendChild(body);
    document.body.appendChild(overlay);

    const w = options.initialSize.width;
    const h = options.initialSize.height;
    overlay.style.left = Math.max(0, (window.innerWidth - w) / 2) + "px";
    overlay.style.top = Math.max(0, (window.innerHeight - h) / 2) + "px";

    const onResize = () => {
      const x = Math.min(overlay.offsetLeft, window.innerWidth - overlay.offsetWidth);
      const y = Math.min(overlay.offsetTop, window.innerHeight - 40);
      overlay.style.left = Math.max(0, x) + "px";
      overlay.style.top = Math.max(0, y) + "px";
    };
    window.addEventListener("resize", onResize);

    let dragging = false, dx = 0, dy = 0;
    header.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      dx = e.clientX - overlay.offsetLeft;
      dy = e.clientY - overlay.offsetTop;
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    header.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(e.clientX - dx, window.innerWidth - overlay.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - dy, window.innerHeight - 40));
      overlay.style.left = x + "px";
      overlay.style.top = y + "px";
    });
    header.addEventListener("pointerup", () => { dragging = false; });

    let minimized = false;
    minimizeBtn.onclick = () => {
      minimized = !minimized;
      body.classList.toggle("ubye-stt-hidden", minimized);
      overlay.style.height = minimized ? "auto" : "";
      overlay.style.minHeight = minimized ? "0" : "";
      overlay.style.resize = minimized ? "none" : "both";
      minimizeBtn.textContent = minimized ? "+" : "\u2212";
    };

    overlay._cleanup = () => { window.removeEventListener("resize", onResize); };

    closeBtn.onclick = () => {
      if (options.onClose && options.onClose() === false) return;
      overlay._cleanup();
      overlay.remove();
    };

    return overlay;
  };
})(UbyeBase);
