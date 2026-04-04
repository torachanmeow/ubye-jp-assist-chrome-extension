// 言語検出器。かな・漢字の出現比率から日本語テキストを判定し、翻訳スキップを決定。
(function (Base) {
  /**
   * 言語検出器を生成する。
   * @param {Object} config
   * @param {RegExp} config.kanaRange - ターゲット言語の固有文字パターン (例: ひらがな・カタカナ)
   * @param {RegExp} config.charRange - ターゲット言語の全文字パターン (例: かな+漢字)
   * @param {number} config.ratio - ターゲット言語とみなす閾値 (0-1)
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

    function shouldSkip(text) {
      const trimmed = text.trim();
      if (trimmed.length <= 1) return true;
      const withoutEmoji = trimmed.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]/gu, "").replace(/:_[a-zA-Z0-9]+:/g, "");
      if (withoutEmoji.length === 0) return true;
      return isTarget(trimmed);
    }

    return { shouldSkip };
  };
})(UbyeBase);
