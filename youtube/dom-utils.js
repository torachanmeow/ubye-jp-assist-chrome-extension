// DOM 操作ヘルパー。メッセージテキスト抽出、contenteditable 入力、iframe 横断検索。
(function (App) {
  const EXCLUDE_CLASSES = ["ytc-translated", "ytc-translating", "ytc-translate-error"];

  App.extractMessageText = function (messageEl, excludeClasses) {
    const exclude = excludeClasses || EXCLUDE_CLASSES;
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeName === "IMG") return "";
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (exclude.some((cls) => node.classList?.contains(cls))) return "";
        let t = "";
        for (const child of node.childNodes) t += walk(child);
        return t;
      }
      return "";
    }
    let text = "";
    for (const child of messageEl.childNodes) text += walk(child);
    return text.trim();
  };

  App.setInputText = function (inputEl, text) {
    inputEl.focus();
    inputEl.textContent = text;
    const range = inputEl.ownerDocument.createRange();
    const sel = inputEl.ownerDocument.getSelection();
    range.selectNodeContents(inputEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  };

  App.findInMainOrChat = function (selector) {
    const el = document.querySelector(selector);
    if (el) return el;
    try {
      const iframe = document.querySelector("iframe#chatframe");
      return iframe?.contentDocument?.querySelector(selector) || null;
    } catch { return null; }
  };
})(UbyeApp);
