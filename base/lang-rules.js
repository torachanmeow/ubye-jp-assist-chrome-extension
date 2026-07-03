// 言語判定のプリセットルール集。lang-detect.js のコアに注入する設定とルール関数を言語ごとに集約。
// 呼び出し元は Base.langRules.<lang>.preset() を createLangDetector に渡すだけで検出器を得られる。
(function (Base) {
  if (Base.langRules) return;

  const KANJI_ONLY_RE = /^[\u4E00-\u9FFF]+$/;
  const STRIP_NOISE_RE = /[\s\p{Emoji_Presentation}\p{Extended_Pictographic}@#]/gu;

  // 現代の日本語では通常使われない簡体字・繁体字・語気助詞の厳選セット。
  // 一文字でも該当すれば中国語由来と判断する (forceTranslate側で使用)。
  // JP でも使う同一コードポイント (号/个など) は含めない。
  //   simplified-only: 你吗们这个么现实样应该说时间对过还让请谁谢气见爱书车马买卖开关门东给从问长张带话钱
  //   traditional-only (kyūjitai で JP は shinjitai に移行済み): 們這嗎麼沒妳會學國對實發變體點價應氣樣壞歸關當聽處畫廣藝讀說寫號內擊
  //   Chinese-distinctive chars: 疼蛋麥滷晚掉德很
  //   Chinese 語気助詞・代名詞: 呢吧啊啦嘛咱啥嗨喔呀哦喲囉咩唷嘻嗯您
  const CJK_ZH_ONLY_RE = /[你吗们这个么现实样应该说时间对过还让请谁谢气见爱书车马买卖开关门东给从问长张带话钱們這嗎麼沒妳會學國對實發變體點價應氣樣壞歸關當聽處畫廣藝讀說寫號內擊疼蛋麥滷晚掉德很呢吧啊啦嘛咱啥嗨喔呀哦喲囉咩唷嘻嗯您]/;

  // 漢字のみで構成される短文を日本語とみなすルール。
  // 2〜数文字の漢字のみ文字列は統計的に日中判別が不可能なため、対象ドメインの事前確率で割り切る。
  // 日本語配信 (sttLang === "ja-JP") では「短漢字≒日本語」だが、中国語配信ではむしろ中国語
  // である可能性が高いため、ja-JP 以外では無効化する (読取は呼び出し時に行い profile 切替に追従)。
  function shortKanjiOnlyAsJa(maxLen) {
    return function (text) {
      if (Base.sttLang !== "ja-JP") return false;
      const clean = text.replace(STRIP_NOISE_RE, "");
      if (clean.length === 0 || clean.length > maxLen) return false;
      return KANJI_ONLY_RE.test(clean);
    };
  }

  // 中国語特有の文字(簡体字・繁体字・語気助詞)を含むかを判定するルール。
  // forceTranslateRules に渡すことで「你好」「谢谢」等が shortKanjiOnlyAsJa に誤って
  // 吸収されるのを防ぐ。
  function hasChineseMarker() {
    return function (text) {
      return CJK_ZH_ONLY_RE.test(text);
    };
  }

  Base.langRules = {
    ja: {
      kanaRange: /[\u3040-\u309F\u30A0-\u30FF]/g,
      charRange: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g,
      ratio: 0.3,
      shortKanjiMaxLen: 6,
      shortKanjiOnlyAsJa: shortKanjiOnlyAsJa,
      hasChineseMarker: hasChineseMarker,

      /**
       * createLangDetector にそのまま渡せる完成形プリセットを返す。
       * 呼び出し元はルール名や閾値を知る必要がない。
       * @returns {Object}
       */
      preset() {
        return {
          kanaRange: this.kanaRange,
          charRange: this.charRange,
          ratio: this.ratio,
          forceTranslateRules: [hasChineseMarker()],
          forceSkipRules: [shortKanjiOnlyAsJa(this.shortKanjiMaxLen)],
        };
      },
    },
  };
})(UbyeBase);
