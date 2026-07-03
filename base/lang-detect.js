// 言語検出器。かな・漢字の出現比率から日本語テキストを判定し、翻訳スキップを決定。
// コアは言語非依存。言語固有の救済/除外ルールは forceSkipRules/forceTranslateRules で注入する。
(function (Base) {
  /**
   * 言語検出器を生成する。
   * @param {Object} config
   * @param {RegExp} config.kanaRange - ターゲット言語の固有文字パターン (例: ひらがな・カタカナ)
   * @param {RegExp} config.charRange - ターゲット言語の全文字パターン (例: かな+漢字)
   * @param {number} config.ratio - ターゲット言語とみなす閾値 (0-1)
   * @param {Array<function(string):boolean>} [config.forceTranslateRules] - true を返したら必ず翻訳する (スキップしない)。forceSkipより優先
   * @param {Array<function(string):boolean>} [config.forceSkipRules] - true を返したら必ずスキップする
   * @returns {{ shouldSkip: function }}
   */
  Base.createLangDetector = function (config) {
    function isTarget(text) {
      const kana = text.match(config.kanaRange);
      if (!kana) return false;
      const jaChars = text.match(config.charRange);
      if (!jaChars) return false;
      const cleanText = text.replace(/[\s\p{Emoji_Presentation}\p{Extended_Pictographic}@#]/gu, "");
      if (cleanText.length === 0) return true;
      return jaChars.length / cleanText.length >= config.ratio;
    }

    const forceTranslate = Array.isArray(config.forceTranslateRules) ? config.forceTranslateRules : [];
    const forceSkip = Array.isArray(config.forceSkipRules) ? config.forceSkipRules : [];

    function shouldSkip(text) {
      const trimmed = text.trim();
      if (trimmed.length <= 1) return true;
      const withoutEmoji = trimmed.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]/gu, "").replace(/:_[a-zA-Z0-9]+:/g, "");
      if (withoutEmoji.length === 0) return true;

      for (let i = 0; i < forceTranslate.length; i++) {
        if (forceTranslate[i](trimmed)) return false;
      }
      for (let i = 0; i < forceSkip.length; i++) {
        if (forceSkip[i](trimmed)) return true;
      }

      return isTarget(trimmed);
    }

    return { shouldSkip };
  };
})(UbyeBase);
