// chrome.runtime.sendMessage の Promise ラッパーと拡張有効性チェック。
(function (Base) {
  Base.sendMsg = function (payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (res?.ok) resolve(res);
        else reject(new Error(res?.error || "Unknown error"));
      });
    });
  };

  /** 拡張が有効か（アンロード済みでないか）を確認 */
  Base.isExtensionValid = function () {
    try { return !!chrome.runtime?.id; } catch { return false; }
  };
})(UbyeBase);
