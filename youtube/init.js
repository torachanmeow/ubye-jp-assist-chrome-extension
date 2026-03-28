// Content script のエントリポイント。storage 監視、メッセージルーティング、DOM ポーリングの起動。
(function () {
if (window.__ubyeJpAssistLoaded) return;
window.__ubyeJpAssistLoaded = true;

if (!UbyeBase._isRelevantFrame) return;

const App = UbyeApp;
const Base = UbyeBase;
const MSG = Base.MSG;
const log = Base.log.create("init");

App.state = {
  sendEnabled: false,
  chatTranslateEnabled: false,
  speechAutoTranslate: false,
  apiKeyConfigured: false,
  sttLogVisible: false,
  sttActive: false,
  chatAutoEnabled: false,
};

App.sttOverlay.setOnTranslated((id, text, status) => App.sttSubtitle.applyTranslation(id, text, status));
App.comments.setOnTranslate(() => App.chat.translateVisibleMessages("comments"));

const DOM_SCAN_THROTTLE_MS = 500;
const TOAST_DISPLAY_MS = 4000;
const getLogFontSize = Base.createStorageValue("logFontSize", undefined, () => {
  const ov = document.getElementById("ubye-stt-overlay");
  if (ov) ov.style.fontSize = getLogFontSize() + "px";
});

/** STT 開始時・表示モード切替時にオーバーレイと字幕の表示状態を同期する */
function syncSttPanels() {
  if (!document.getElementById("ubye-stt-overlay")) App.sttOverlay.create();
  const ov = document.getElementById("ubye-stt-overlay");
  if (ov) {
    ov.style.fontSize = getLogFontSize() + "px";
    App.sttOverlay.syncAutoTranslateBtn();
    if (!App.state.sttLogVisible) {
      ov.style.setProperty("display", "none", "important");
    } else {
      ov.style.removeProperty("display");
      const body = ov.querySelector(".ubye-overlay-body");
      if (body) body.scrollTop = body.scrollHeight;
    }
  }
  App.sttSubtitle.create();
}

chrome.storage.local.get({
  sendEnabled: false,
  chatTranslateEnabled: false,
  speechAutoTranslate: Base.DEFAULTS.speechAutoTranslate,
  sttLogVisible: Base.DEFAULTS.sttLogVisible,
  profile: Base.DEFAULT_PROFILE,
  geminiApiKey: Base.DEFAULTS.geminiApiKey,
}, (cfg) => {
  App.state.sendEnabled = cfg.sendEnabled;
  App.state.chatTranslateEnabled = cfg.chatTranslateEnabled;
  App.state.speechAutoTranslate = cfg.speechAutoTranslate;
  App.state.apiKeyConfigured = !!cfg.geminiApiKey;
  App.state.sttLogVisible = cfg.sttLogVisible;
  Base.applyProfile(cfg.profile);
});

const storageChangeHandlers = {
  sendEnabled(v) { App.state.sendEnabled = v; },
  chatTranslateEnabled(v) { App.state.chatTranslateEnabled = v; },
  geminiApiKey(v) {
    App.state.apiKeyConfigured = !!v;
    App.sttOverlay.syncAutoTranslateBtn();
    App.sttOverlay.syncTranslateButtons();
  },
  profile(v) {
    Base.applyProfile(v);
    App.sttOverlay.syncTitle();
    App.sttOverlay.syncAutoTranslateBtn();
    App.send.removeAllButtons(document);
    try {
      const iframe = document.querySelector("iframe#chatframe");
      if (iframe?.contentDocument) App.send.removeAllButtons(iframe.contentDocument);
    } catch {}
  },
  speechAutoTranslate(v) {
    App.state.speechAutoTranslate = v;
    App.sttOverlay.syncAutoTranslateBtn();
  },
  sttLogVisible(v) {
    App.state.sttLogVisible = v;
    if (App.state.sttActive) syncSttPanels();
  },
  subtitleFontSize(v) {
    const subtitle = document.getElementById("ubye-stt-subtitle-dock");
    if (subtitle) subtitle.style.fontSize = v + "px";
  },
};

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  for (const key in changes) {
    if (storageChangeHandlers[key]) storageChangeHandlers[key](changes[key].newValue);
  }
});

let toastEl = null;
let toastTimer = null;

function showToast(text, hint) {
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
}

const messageHandlers = {
  [MSG.STT_BROADCAST](msg) {
    App.sttOverlay.handleBroadcast(msg);
    if (document.getElementById("ubye-stt-subtitle-dock")) App.sttSubtitle.handleBroadcast(msg);
  },
  [MSG.TOAST](msg) {
    showToast(msg.text, msg.hint);
  },
  [MSG.STT_CLEAR_LOG]() {
    App.sttOverlay.clearLog();
  },
  [MSG.STT_OVERLAY](msg) {
    if (window !== window.top) return;
    if (msg.show) {
      App.state.sttActive = true;
      syncSttPanels();
    } else {
      App.state.sttActive = false;
      App.sttSubtitle.destroy();
      const interimEl = document.getElementById("ubye-stt-interim");
      if (interimEl) interimEl.textContent = "";
    }
  },
};

chrome.runtime.onMessage.addListener((msg) => {
  const handler = messageHandlers[msg.type];
  if (handler) handler(msg);
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
  lastUrl = currentUrl;
  if (!wasVideo) return;
  if (App.state.sttActive) {
    chrome.runtime.sendMessage({ type: MSG.STT_STOP_CAPTURE }).catch((e) => log.debug("msg dropped:", e.message));
    App.sttSubtitle.destroy();
  }
  App.sttOverlay.clearLog();
  const ov = document.getElementById("ubye-stt-overlay");
  if (ov) {
    if (ov._cleanup) ov._cleanup();
    ov.style.setProperty("display", "none", "important");
  }
}

function init() {
  if (!Base.isExtensionValid()) return;

  scanDom();

  // DOM 変更検知 → デバウンスしてスキャン
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

  // SPA ナビゲーション検知（top frame のみ）
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
