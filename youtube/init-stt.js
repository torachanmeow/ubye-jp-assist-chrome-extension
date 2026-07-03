// YouTube STT 初期化。startCapture 時に動的注入される。
(function () {
if (window.__ubyeSttLoaded) return;
window.__ubyeSttLoaded = true;

if (!UbyeBase._isRelevantFrame) return;

const App = UbyeApp;
const Base = UbyeBase;

// init-static.js が先に実行済み。既存の値を保持しつつ STT 用の状態を追加。
App.state = App.state || {};
if (App.state.speechAutoTranslate === undefined) App.state.speechAutoTranslate = false;
if (App.state.apiKeyConfigured === undefined) App.state.apiKeyConfigured = false;
if (App.state.sttLogVisible === undefined) App.state.sttLogVisible = false;
if (App.state.sttActive === undefined) App.state.sttActive = false;

const { storageHandlers, messageHandlers, loadSttState } = Base.setupSttLifecycle(App);

// YouTube 固有: profile 変更時に送信ボタンもクリーンアップ
const baseProfileHandler = storageHandlers.profile;
storageHandlers.profile = function (v) {
  baseProfileHandler(v);
  App.send.removeAllButtons(document);
  try {
    const iframe = document.querySelector("iframe#chatframe");
    if (iframe?.contentDocument) App.send.removeAllButtons(iframe.contentDocument);
  } catch {}
};

// STT メッセージハンドラを共有ハンドラマップに登録
for (const key in messageHandlers) {
  Base._messageHandlers[key] = messageHandlers[key];
}

// STT 用 storage リスナー
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  for (const key in changes) {
    if (storageHandlers[key]) storageHandlers[key](changes[key].newValue);
  }
});

loadSttState({ sendEnabled: false, chatTranslateEnabled: false }, (cfg) => {
  App.state.sendEnabled = cfg.sendEnabled;
  App.state.chatTranslateEnabled = cfg.chatTranslateEnabled;
});
})();
