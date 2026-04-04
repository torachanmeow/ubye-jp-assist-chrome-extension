// プロファイル管理と翻訳プロンプト生成。言語に応じた speech/chat/send プロンプトを自動構築。
(function (Base) {
  if (Base.PROFILES) return; // 動的注入の冪等性ガード
  Base.GEMINI_MODELS = [
    { value: "gemini-2.5-flash-lite", label: "2.5 Flash Lite" },
    { value: "gemini-3.1-flash-lite-preview", label: "3.1 Flash Lite" },
  ];

  Base.PROFILES = {};
  Base.YOUTUBE_ORIGIN = "https://www.youtube.com";
  Base.DEFAULT_PROFILE = "zh-tw-general";
  Base.activeProfile = null;

  const LANG_LABELS = {
    "ja-JP": "Japanese",
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
    "en-US": "English",
    "en-GB": "English",
    "ko-KR": "Korean",
    "es-ES": "Spanish",
    "fr-FR": "French",
    "de-DE": "German",
    "pt-BR": "Portuguese",
    "ru-RU": "Russian",
    "id-ID": "Indonesian",
    "th-TH": "Thai",
    "vi-VN": "Vietnamese",
  };

  const LANG_SHORT = {
    "ja-JP": "日",
    "zh-CN": "中",
    "zh-TW": "中",
    "en-US": "EN",
    "en-GB": "EN",
    "ko-KR": "韓",
    "es-ES": "ES",
    "fr-FR": "FR",
    "de-DE": "DE",
    "pt-BR": "PT",
    "ru-RU": "RU",
    "id-ID": "ID",
    "th-TH": "TH",
    "vi-VN": "VI",
  };

  const SCRIPT_HINTS = {
    "zh-TW": {
      speech: "The input uses Traditional Chinese characters (繁體字). ",
      send: "You MUST use Traditional Chinese characters (繁體字), never use Simplified Chinese characters. ",
    },
    "zh-CN": {
      speech: "The input uses Simplified Chinese characters (简体字). ",
      send: "You MUST use Simplified Chinese characters (简体字), never use Traditional Chinese characters. ",
    },
  };

  Base.registerProfile = function (key, profile) {
    Base.PROFILES[key] = profile;
    if (!Base.activeProfile && key === Base.DEFAULT_PROFILE) {
      Base.applyProfile(key);
    }
  };

  const COMMON_TRANSLATE_RULES =
      "You are a translator, not an assistant. Never generate original responses or answer questions. " +
      "Output only the translation. Do NOT echo or repeat the input text. Do not add notes, explanations, or parenthetical comments. " +
      "If the input is only numbers or symbols, output them as-is. " +
      "Never repeat the same word or phrase more times than it appears in the original text.";

  Base.applyProfile = function (key) {
    const profile = Base.PROFILES[key] || Base.PROFILES[Base.DEFAULT_PROFILE];
    if (!profile) return;
    const sttLang = profile.sttLang;
    const langName = LANG_LABELS[sttLang] || sttLang;
    const hint = SCRIPT_HINTS[sttLang] || { speech: "", send: "" };
    const profileHints = profile.hints || {};
    Base.PROMPTS = {
      speech: {
        base:
          "Translate " + langName + " to natural Japanese. " +
          "The input is " + langName + " text. " + hint.speech +
          "Always output Japanese (hiragana, katakana, kanji), never output Chinese characters as-is. " +
          COMMON_TRANSLATE_RULES,
        hints: profileHints.speech || "",
      },
      chat: {
        base:
          "Translate any non-Japanese text to natural Japanese. " +
          "The input may be in any language but is most likely " + langName + ". " + hint.speech +
          "Always output Japanese (hiragana, katakana, kanji), never output Chinese characters as-is. " +
          COMMON_TRANSLATE_RULES,
        hints: profileHints.chat || "",
      },
      send: {
        base:
          "Translate Japanese to " + langName + ". " +
          "The input is Japanese text. Always output " + langName + ", never output Japanese. " + hint.send +
          COMMON_TRANSLATE_RULES + " " +
          "Use natural, polite colloquial expressions. Avoid vulgar or offensive language. Choose simple, easy-to-understand vocabulary.",
        hints: profileHints.send || "",
      },
    };
    Base.sttLang = sttLang;
    Base.sendLabel = "日→" + (LANG_SHORT[sttLang] || sttLang);
    Base.activeProfile = key;
  };

  Base.SKIP_LANG = {
    jaRatio: 0.3,
    jaKanaRange: /[\u3040-\u309F\u30A0-\u30FF]/g,
    jaCharRange: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g,
  };
})(UbyeBase);
