// ポップアップ UI。設定の読み書き、STT キャプチャの開始/停止、モデル・スライダー操作。
const Base = UbyeBase;
const MSG = Base.MSG;
const DEFAULT_MODEL = Base.DEFAULT_GEMINI_MODEL;

const defaults = Object.assign({}, Base.DEFAULTS, {
  chatModel: DEFAULT_MODEL,
  sendModel: DEFAULT_MODEL,
  speechModel: DEFAULT_MODEL,
  sendEnabled: false,
  chatTranslateEnabled: false,
  profile: Base.DEFAULT_PROFILE,
});

/** スライダー/数値入力の定義テーブル: [storageKey, 表示suffix, formatFn, saveFn, loadFn] */
const RANGE_INPUTS = [
  ["chatAutoInterval", "秒", (v) => (v === 0 ? "OFF" : v + "秒")],
  ["batchChunkSize", "件"],
  ["subtitleFadeTime", "秒"],
  ["sttMaxLines", "行"],
  ["subtitleFontSize", "px"],
  ["logFontSize", "px"],
  ["sttBgOpacity", "%", (v) => v + "%", (v) => v / 100, (v) => Math.round(v * 100)],
];

function setupRangeInput(id, suffix, formatFn, transformFn) {
  const display = formatFn || ((v) => v + suffix);
  document.getElementById(id).addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    document.getElementById(id + "Val").textContent = display(val);
    chrome.storage.local.set({ [id]: transformFn ? transformFn(val) : val });
  });
}

function populateModelSelects() {
  for (const id of ["chatModel", "sendModel", "speechModel"]) {
    const sel = document.getElementById(id);
    for (const m of Base.GEMINI_MODELS) {
      const opt = document.createElement("option");
      opt.value = m.value;
      opt.textContent = m.label;
      sel.appendChild(opt);
    }
  }
}

function populateProfiles() {
  const sel = document.getElementById("profile");
  for (const [key, profile] of Object.entries(Base.PROFILES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = profile.label;
    sel.appendChild(opt);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  populateModelSelects();
  populateProfiles();
  chrome.storage.local.get(defaults, (cfg) => {
    document.getElementById("profile").value = cfg.profile;
    document.getElementById("geminiApiKey").value = cfg.geminiApiKey;
    document.getElementById("sendEnabled").checked = cfg.sendEnabled;
    document.getElementById("chatTranslateEnabled").checked = cfg.chatTranslateEnabled;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const url = tab?.url || "";
      const isYouTube = url.startsWith(UbyeBase.YOUTUBE_ORIGIN + "/watch") || url.startsWith(UbyeBase.YOUTUBE_ORIGIN + "/shorts/");
      const startBtn = document.getElementById("sttStart");
      if (!isYouTube) {
        document.getElementById("pageNotice").style.display = "";
        for (const el of document.getElementById("youtubeOnlySection").querySelectorAll("input, select")) {
          el.disabled = true;
        }
      }
      chrome.runtime.sendMessage({ type: MSG.STT_GET_CAPTURE_TAB }).then((captureTabId) => {
        if (captureTabId && captureTabId === tab?.id) {
          startBtn.style.display = "none";
          document.getElementById("sttStop").style.display = "";
          document.getElementById("sttStatus").textContent = "認識中";
        } else if (captureTabId) {
          startBtn.disabled = true;
          document.getElementById("sttStatus").textContent = "別タブで使用中です";
        }
      }).catch(() => {});
    }).catch(() => {});
    document.getElementById("chatModel").value = cfg.chatModel;
    document.getElementById("sendModel").value = cfg.sendModel;
    document.getElementById("speechModel").value = cfg.speechModel;
    for (const [id, suffix, formatFn, , loadFn] of RANGE_INPUTS) {
      const raw = loadFn ? loadFn(cfg[id]) : cfg[id];
      document.getElementById(id).value = raw;
      document.getElementById(id + "Val").textContent = (formatFn || ((v) => v + suffix))(raw);
    }
    document.getElementById("speechAutoTranslate").checked = cfg.speechAutoTranslate;
    document.getElementById("sttLogVisible").checked = cfg.sttLogVisible;
  });

  /** storage に直接保存する change ハンドラをまとめて登録 */
  const STORAGE_INPUTS = [
    ["profile", "profile"],
    ["chatTranslateEnabled", "chatTranslateEnabled"],
    ["sendEnabled", "sendEnabled"],
    ["speechAutoTranslate", "speechAutoTranslate"],
    ["sttLogVisible", "sttLogVisible"],
    ["chatModel", "chatModel"],
    ["sendModel", "sendModel"],
    ["speechModel", "speechModel"],
  ];
  for (const [id, key, getValue] of STORAGE_INPUTS) {
    document.getElementById(id).addEventListener("change", (e) => {
      const value = getValue ? getValue(e) : (e.target.type === "checkbox" ? e.target.checked : e.target.value);
      chrome.storage.local.set({ [key]: value });
    });
  }

  document.getElementById("sttStart").addEventListener("click", async () => {
    const startBtn = document.getElementById("sttStart");
    const statusEl = document.getElementById("sttStatus");
    startBtn.disabled = true;
    statusEl.textContent = "接続中...";
    let keepDisabled = false;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error("アクティブタブが見つかりません");
      const res = await chrome.runtime.sendMessage({ type: MSG.STT_START_CAPTURE, tabId: tab.id });
      if (res?.ok) {
        statusEl.textContent = "認識中";
        startBtn.style.display = "none";
        document.getElementById("sttStop").style.display = "";
      } else {
        statusEl.textContent = res?.error || "開始に失敗";
        if (res?.code === "busy") keepDisabled = true;
      }
    } catch (e) {
      statusEl.textContent = e.message;
    } finally {
      if (!keepDisabled) {
        startBtn.disabled = false;
      }
    }
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG.STT_CAPTURE_STOPPED) {
      document.getElementById("sttStart").style.display = "";
      document.getElementById("sttStart").disabled = false;
      document.getElementById("sttStop").style.display = "none";
      document.getElementById("sttStatus").textContent = "";
    }
  });
  document.getElementById("sttStop").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: MSG.STT_STOP_CAPTURE });
  });
  document.getElementById("sttClearLog").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.tabs.sendMessage(tab.id, { type: MSG.STT_CLEAR_LOG });
  });

  for (const [id, suffix, formatFn, transformFn] of RANGE_INPUTS) {
    setupRangeInput(id, suffix, formatFn, transformFn);
  }
  document.getElementById("save").addEventListener("click", () => {
    const geminiApiKey = document.getElementById("geminiApiKey").value.trim();
    const statusEl = document.getElementById("status");
    // Google APIキーのフォーマット変更時は正規表現の上限値を要更新
    if (geminiApiKey && !/^AIza[0-9A-Za-z_-]{35,45}$/.test(geminiApiKey)) {
      statusEl.textContent = "API Keyの形式が正しくありません";
      statusEl.style.color = "#e57373";
      statusEl.style.opacity = "1";
      setTimeout(() => { statusEl.style.opacity = "0"; statusEl.style.color = ""; }, 3000);
      return;
    }
    chrome.storage.local.set({ geminiApiKey }, () => {
      statusEl.textContent = geminiApiKey ? "保存しました" : "API Keyを削除しました";
      statusEl.style.color = "";
      statusEl.style.opacity = "1";
      setTimeout(() => { statusEl.style.opacity = "0"; }, 2000);
    });
  });

});
