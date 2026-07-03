// 静的 content script 用の共通メッセージリスナー。
// STT 初期化時にハンドラを追加登録できる拡張可能な設計。
(function (Base) {
  if (Base._messageHandlers) return; // 動的注入の冪等性ガード
  if (!Base._isRelevantFrame) return;

  const MSG = Base.MSG;

  /** @type {Object<string, function>} メッセージタイプ → ハンドラ */
  Base._messageHandlers = {};

  // TOAST は STT 外（コンテキストメニュー等）からも飛ぶため静的に登録
  Base._messageHandlers[MSG.TOAST] = function (msg) {
    Base.showToast(msg.text, msg.hint);
  };

  chrome.runtime.onMessage.addListener((msg) => {
    const handler = Base._messageHandlers[msg.type];
    if (handler) handler(msg);
  });
})(UbyeBase);
