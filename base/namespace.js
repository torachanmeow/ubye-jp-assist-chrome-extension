// グローバル名前空間 UbyeBase の定義。デフォルト設定値、ログユーティリティ、storage リアクティブ追跡。
var UbyeBase = globalThis.UbyeBase = globalThis.UbyeBase || {};
if (!UbyeBase._initialized) {
  UbyeBase._initialized = true;
  UbyeBase._relevantPaths = [];
  UbyeBase._isRelevantFrame = (function () {
    try { return window === window.top; }
    catch { return false; }
  })();
  UbyeBase.addRelevantPath = function (prefix) {
    UbyeBase._relevantPaths.push(prefix);
    if (!UbyeBase._isRelevantFrame) {
      try { UbyeBase._isRelevantFrame = location.pathname.startsWith(prefix); }
      catch {}
    }
  };
  UbyeBase.DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
  UbyeBase.STT_BG_RGB = "30,30,30";
  UbyeBase.DEFAULTS = {
    geminiApiKey: "",
    subtitleFontSize: 22,
    logFontSize: 14,
    sttMaxLines: 50,
    subtitleFadeTime: 20,
    sttBgOpacity: 0.8,
    speechAutoTranslate: false,
    chatAutoInterval: 0,
    batchChunkSize: 50,
    sttLogVisible: false,
  };

  /**
   * ログユーティリティ。DevTools コンソールで [Ubye:module] プレフィックス付きで出力。
   * レベル: debug < info < warn < error
   * Base.log.level = "debug" で全出力、"warn"(デフォルト) で warn/error のみ。
   */
  (function () {
    var LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
    var log = { level: "warn" };

    function createLogger(module) {
      const prefix = "[Ubye:" + module + "]";
      return {
        debug(...args) { if (LEVELS[log.level] <= 0) console.debug(prefix, ...args); },
        info(...args)  { if (LEVELS[log.level] <= 1) console.info(prefix, ...args); },
        warn(...args)  { if (LEVELS[log.level] <= 2) console.warn(prefix, ...args); },
        error(...args) { if (LEVELS[log.level] <= 3) console.error(prefix, ...args); },
      };
    }

    log.create = createLogger;
    UbyeBase.log = log;
  })();

  /**
   * chrome.storage.local の値をリアクティブに追跡するユーティリティ。
   * 初回読み込み＋変更リスナーを一括で登録し、現在値を返すゲッターを返す。
   * @param {string} key - storage キー
   * @param {*} [defaultValue] - 初期値（省略時は DEFAULTS[key]）
   * @param {function} [onChange] - 値変更時のコールバック
   * @returns {function} 現在値を返すゲッター関数
   */
  (function () {
    var watchers = {};
    var listenerRegistered = false;

    UbyeBase.createStorageValue = function (key, defaultValue, onChange) {
      var def = defaultValue !== undefined ? defaultValue : UbyeBase.DEFAULTS[key];
      var entry = { value: def, onChange: onChange };
      if (!UbyeBase._isRelevantFrame) return function () { return entry.value; };

      watchers[key] = entry;
      chrome.storage.local.get({ [key]: def }, function (cfg) {
        entry.value = cfg[key];
        if (entry.onChange) entry.onChange(entry.value);
      });

      if (!listenerRegistered) {
        listenerRegistered = true;
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== "local") return;
          for (var k in changes) {
            if (watchers[k]) {
              watchers[k].value = changes[k].newValue;
              if (watchers[k].onChange) watchers[k].onChange(changes[k].newValue);
            }
          }
        });
      }

      return function () { return entry.value; };
    };
  })();
}
