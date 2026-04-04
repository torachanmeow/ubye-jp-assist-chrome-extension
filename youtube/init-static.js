// YouTube 静的初期化。DOM スキャン、MutationObserver、SPA 遷移検知、チャット/送信/コメント UI。
// STT 関連は init-stt.js で動的に注入される。
(function () {
if (window.__ubyeJpAssistLoaded) return;
window.__ubyeJpAssistLoaded = true;

if (!UbyeBase._isRelevantFrame) return;

const App = UbyeApp;
const Base = UbyeBase;
const MSG = Base.MSG;
const log = Base.log.create("init");

const DOM_SCAN_THROTTLE_MS = 500;

App.state = App.state || {};
App.state.sendEnabled = false;
App.state.chatTranslateEnabled = false;
App.state.apiKeyConfigured = false;
App.state.chatAutoEnabled = false;

App.comments.setOnTranslate(() => App.chat.translateVisibleMessages("comments"));

// YouTube 固有の storage ハンドラ
const storageHandlers = {
  sendEnabled(v) { App.state.sendEnabled = v; },
  chatTranslateEnabled(v) { App.state.chatTranslateEnabled = v; },
  geminiApiKey(v) { App.state.apiKeyConfigured = !!v; },
  profile(v) {
    Base.applyProfile(v);
    App.send.removeAllButtons(document);
    try {
      const iframe = document.querySelector("iframe#chatframe");
      if (iframe?.contentDocument) App.send.removeAllButtons(iframe.contentDocument);
    } catch {}
  },
};

chrome.storage.local.get({ sendEnabled: false, chatTranslateEnabled: false, geminiApiKey: "", profile: Base.DEFAULT_PROFILE }, (cfg) => {
  App.state.sendEnabled = cfg.sendEnabled;
  App.state.chatTranslateEnabled = cfg.chatTranslateEnabled;
  App.state.apiKeyConfigured = !!cfg.geminiApiKey;
  Base.applyProfile(cfg.profile);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  for (const key in changes) {
    if (storageHandlers[key]) storageHandlers[key](changes[key].newValue);
  }
});

function scanDom() {
  const chatDoc = App.chat.pollChat();
  if (chatDoc) {
    try { App.send.setupChatButton(chatDoc); } catch (e) { log.warn("setupChatButton", e); }
    try { App.send.setupSuperChatButton(chatDoc); } catch (e) { log.warn("setupSuperChatButton", e); }
  }
  try { App.send.setupCommentButton(document); } catch (e) { log.warn("setupCommentButton", e); }
  try { App.comments.setupCommentTranslateBtn(document); } catch (e) { log.warn("setupCommentTranslateBtn", e); }
}

let lastUrl = location.pathname + location.search;

function checkPageChange() {
  const currentUrl = location.pathname + location.search;
  if (currentUrl === lastUrl) return;
  const wasVideo = lastUrl.startsWith("/watch") || lastUrl.startsWith("/shorts/");
  const isVideo = currentUrl.startsWith("/watch") || currentUrl.startsWith("/shorts/");
  lastUrl = currentUrl;
  if (!wasVideo) return;
  // STT モジュールがロード済みの場合のみクリーンアップ
  Base.sttOverlay?.clearLog();
  if (!isVideo) {
    if (App.state.sttActive) {
      App.state.sttActive = false;
      chrome.runtime.sendMessage({ type: MSG.STT_STOP_CAPTURE }).catch((e) => log.debug("msg dropped:", e.message));
      App.sttSubtitle?.destroy();
    }
    const ov = document.getElementById("ubye-stt-overlay");
    if (ov) {
      if (ov._cleanup) ov._cleanup();
      ov.style.setProperty("display", "none", "important");
    }
  }
}

function init() {
  if (!Base.isExtensionValid()) return;

  scanDom();

  let scanTimer = null;
  const domObserver = new MutationObserver(() => {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (!Base.isExtensionValid()) { cleanup(); return; }
      scanDom();
    }, DOM_SCAN_THROTTLE_MS);
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  function onNavigate() {
    if (!Base.isExtensionValid()) { cleanup(); return; }
    checkPageChange();
    scanDom();
  }

  if (window === window.top) {
    document.addEventListener("yt-navigate-finish", onNavigate);
    window.addEventListener("popstate", onNavigate);
  }

  function cleanup() {
    domObserver.disconnect();
    if (scanTimer !== null) { clearTimeout(scanTimer); scanTimer = null; }
    document.removeEventListener("yt-navigate-finish", onNavigate);
    window.removeEventListener("popstate", onNavigate);
  }
}

init();
})();
