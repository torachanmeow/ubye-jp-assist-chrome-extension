// 右クリックコンテキストメニュー。音声認識の開始/停止、自動翻訳切替。
(function (Base) {
  const log = Base.log.create("ctx-menu");

  const MENU_ID = {
    PARENT: "ubye-parent",
    STT_TOGGLE: "ubye-stt-toggle",
    AUTO_TRANSLATE: "ubye-auto-translate",
  };

  async function getMenuState() {
    const cfg = await chrome.storage.local.get({ speechAutoTranslate: false, profile: UbyeBase.DEFAULT_PROFILE });
    return { speechAutoTranslate: cfg.speechAutoTranslate, sttLangIsJa: isJaProfile(cfg.profile) };
  }

  let menusReady = getMenuState().then((state) => createMenus(state));

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (changes.speechAutoTranslate || changes.profile) {
      await menusReady;
      const state = await getMenuState();
      updateAutoTranslateMenu(state);
    }
  });

  function isJaProfile(profileKey) {
    const profile = UbyeBase.PROFILES[profileKey];
    return profile?.sttLang === "ja-JP";
  }

  function createMenus(state) {
    return new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
          id: MENU_ID.PARENT,
          title: "Ubye JP Assist：音声認識・翻訳ツール",
          contexts: ["page", "video"],
          documentUrlPatterns: ["https://www.youtube.com/watch*", "https://www.youtube.com/shorts/*"],
        });

        chrome.contextMenus.create({
          id: MENU_ID.STT_TOGGLE,
          parentId: MENU_ID.PARENT,
          title: "字幕を表示する",
          type: "checkbox",
          checked: false,
          contexts: ["page", "video"],
        });

        chrome.contextMenus.create({
          id: MENU_ID.AUTO_TRANSLATE,
          parentId: MENU_ID.PARENT,
          title: "字幕を翻訳する",
          type: "checkbox",
          checked: state.speechAutoTranslate,
          enabled: !state.sttLangIsJa,
          contexts: ["page", "video"],
        }, resolve);
      });
    });
  }

  async function updateSttMenu(capturing) {
    await menusReady;
    chrome.contextMenus.update(MENU_ID.STT_TOGGLE, { checked: capturing });
  }

  function updateAutoTranslateMenu(state) {
    chrome.contextMenus.update(MENU_ID.AUTO_TRANSLATE, {
      checked: state.speechAutoTranslate,
      enabled: !state.sttLangIsJa,
    });
  }

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === MENU_ID.STT_TOGGLE) {
      const captureTabId = Base.sttTab.getCaptureTabId();
      if (captureTabId) {
        Base.sttTab.stopCapture();
      } else {
        try {
          await Base.sttTab.startCapture(tab.id);
        } catch (e) {
          log.warn("コンテキストメニューからの開始失敗:", e.message);
        }
      }
      return;
    }

    if (info.menuItemId === MENU_ID.AUTO_TRANSLATE) {
      const state = await getMenuState();
      if (!state.speechAutoTranslate) {
        const cfg = await chrome.storage.local.get({ geminiApiKey: "" });
        if (!cfg.geminiApiKey) {
          chrome.tabs.sendMessage(tab.id, {
            type: Base.MSG.TOAST,
            text: "API Keyが未設定です",
            hint: "拡張アイコンからポップアップを開いて設定してください",
          }).catch(() => {});
          return;
        }
      }
      chrome.storage.local.set({ speechAutoTranslate: !state.speechAutoTranslate });
      return;
    }
  });

  Base.sttTab.onStart(() => updateSttMenu(true));
  Base.sttTab.onStop(() => updateSttMenu(false));
})(UbyeBase);
