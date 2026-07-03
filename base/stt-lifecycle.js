// STT ライフサイクルの共通セットアップ。overlay/字幕の初期化、storage・メッセージハンドラの定義。
(function (Base) {
  if (Base.setupSttLifecycle) return; // 動的注入の冪等性ガード
  const MSG = Base.MSG;

  /**
   * STT 関連の共通初期化を行い、storage/message ハンドラを返す。
   * @param {object} App - サイト固有の名前空間（App.state, App.sttSubtitle を持つ）
   * @returns {{ syncSttPanels: function, storageHandlers: object, messageHandlers: object, loadSttState: function }}
   */
  Base.setupSttLifecycle = function (App) {
    Base.sttOverlay.bind(
      () => App.state,
      () => {
        App.state.speechAutoTranslate = !App.state.speechAutoTranslate;
        chrome.storage.local.set({ speechAutoTranslate: App.state.speechAutoTranslate });
      }
    );
    Base.sttOverlay.setOnTranslated((id, text, status) => App.sttSubtitle.applyTranslation(id, text, status));

    const getLogFontSize = Base.createStorageValue("logFontSize", undefined, () => {
      const ov = document.getElementById("ubye-stt-overlay");
      if (ov) ov.style.fontSize = getLogFontSize() + "px";
    });

    function syncSttPanels() {
      if (!document.getElementById("ubye-stt-overlay")) Base.sttOverlay.create();
      const ov = document.getElementById("ubye-stt-overlay");
      if (ov) {
        ov.style.fontSize = getLogFontSize() + "px";
        Base.sttOverlay.syncAutoTranslateBtn();
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

    /**
     * 共通 STT 設定の初期読み込み。
     * @param {object} [extraDefaults] - 追加で読み込む storage キーとデフォルト値
     * @param {function} [cb] - 読み込み完了コールバック (cfg) => void
     */
    function loadSttState(extraDefaults, cb) {
      if (typeof extraDefaults === "function") { cb = extraDefaults; extraDefaults = {}; }
      const defaults = Object.assign({
        speechAutoTranslate: Base.DEFAULTS.speechAutoTranslate,
        sttLogVisible: Base.DEFAULTS.sttLogVisible,
        profile: Base.DEFAULT_PROFILE,
        geminiApiKey: Base.DEFAULTS.geminiApiKey,
      }, extraDefaults);
      chrome.storage.local.get(defaults, (cfg) => {
        App.state.speechAutoTranslate = cfg.speechAutoTranslate;
        App.state.apiKeyConfigured = !!cfg.geminiApiKey;
        App.state.sttLogVisible = cfg.sttLogVisible;
        Base.applyProfile(cfg.profile);
        if (cb) cb(cfg);
      });
    }

    const storageHandlers = {
      geminiApiKey(v) {
        App.state.apiKeyConfigured = !!v;
        Base.sttOverlay.syncAutoTranslateBtn();
        Base.sttOverlay.syncTranslateButtons();
      },
      speechModel() {
        Base.sttOverlay.syncAutoTranslateBtn();
        Base.sttOverlay.syncTranslateButtons();
      },
      profile(v) {
        Base.applyProfile(v);
        Base.sttOverlay.syncTitle();
        Base.sttOverlay.syncAutoTranslateBtn();
      },
      speechAutoTranslate(v) {
        App.state.speechAutoTranslate = v;
        Base.sttOverlay.syncAutoTranslateBtn();
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

    const messageHandlers = {
      [MSG.STT_BROADCAST](msg) {
        const lineId = Base.sttOverlay.handleBroadcast(msg);
        if (document.getElementById("ubye-stt-subtitle-dock")) App.sttSubtitle.handleBroadcast(msg, lineId);
      },
      [MSG.STT_CLEAR_LOG]() {
        Base.sttOverlay.clearLog();
      },
      [MSG.STT_OVERLAY](msg) {
        if (window !== window.top) return;
        if (msg.show) {
          App.state.sttActive = true;
          syncSttPanels();
        } else {
          App.state.sttActive = false;
          App.sttSubtitle.destroy();
          const ov = document.getElementById("ubye-stt-overlay");
          if (ov) ov.style.setProperty("display", "none", "important");
          const interimEl = document.getElementById("ubye-stt-interim");
          if (interimEl) interimEl.textContent = "";
        }
      },
    };

    return { syncSttPanels, storageHandlers, messageHandlers, loadSttState };
  };
})(UbyeBase);
