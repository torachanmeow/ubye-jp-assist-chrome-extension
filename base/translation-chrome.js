// Chrome 内蔵 Translator API ラッパー。コンテンツスクリプトで動作し、ローカル翻訳を提供。
// source はテキストごとに chrome.i18n.detectLanguage で自動判定し、プロファイル設定に依存しない。
// target と同言語・検出失敗・利用不可の場合は原文をそのまま返す (呼び出し元はラッパーの制約を知らない)。
(function (Base) {
  if (Base.chromeTranslator) return;
  const log = Base.log.create("chrome-trans");

  const TARGET_LANG = "ja";

  const translatorCache = new Map();   // sourceLang -> Translator
  const creatingPromises = new Map();  // sourceLang -> Promise<Translator|null>
  const unavailableSet = new Set();    // 利用不可と判明した sourceLang
  const toastShown = new Set();        // 初回DLトーストを出した sourceLang (重複抑止)

  // CLD は短文で信頼性が低く、Latin 系を Galician/Kyrgyz/Sundanese 等に誤検出することがある。
  // 検出された全候補 (confidence 降順) を返し、呼び出し側で順次試行させる。
  async function detectSources(text) {
    try {
      const r = await chrome.i18n.detectLanguage(text);
      return (r?.languages || []).map((l) => l.language).filter(Boolean);
    } catch {
      return [];
    }
  }

  // Latin-only 短文は CLD 誤検出の影響で訳せない場合の最終フォールバック。
  // 非 ASCII を含むテキストや長文には適用しない (本物のマイナー言語を en 誤訳するのを避ける)。
  const ASCII_RE = /^[\x00-\x7F]+$/;
  function shouldFallbackToEn(text) {
    return text.length <= 60 && ASCII_RE.test(text);
  }

  async function createTranslator(sourceLang) {
    if (typeof self.Translator === "undefined") {
      throw new Error("Chrome翻訳APIが利用できません（Chrome 138+が必要です）");
    }
    const availability = await Translator.availability({
      sourceLanguage: sourceLang,
      targetLanguage: TARGET_LANG,
    });
    if (availability === "unavailable") {
      // CLD の短文誤検出 (az/ky/su 等) で頻発するため debug レベルに抑える。
      unavailableSet.add(sourceLang);
      log.debug(sourceLang + "→" + TARGET_LANG + " は利用できません (原文のまま表示)");
      return null;
    }
    log.info("翻訳モデル準備中:", sourceLang, "→", TARGET_LANG, "(status:", availability + ")");
    return Translator.create({
      sourceLanguage: sourceLang,
      targetLanguage: TARGET_LANG,
    });
  }

  async function createAndCache(sourceLang) {
    try {
      const translator = await createTranslator(sourceLang);
      if (translator) translatorCache.set(sourceLang, translator);
      return translator;
    } catch (e) {
      if (e?.message?.includes("user gesture") && !toastShown.has(sourceLang)) {
        toastShown.add(sourceLang);
        Base.showToast?.("翻訳モデルの初回DLが必要です", "ログビューアの翻訳ボタンを手動で1回押してください");
      }
      log.debug("translator 作成失敗:", sourceLang, e?.message);
      return null;
    } finally {
      creatingPromises.delete(sourceLang);
    }
  }

  function getTranslatorFor(sourceLang) {
    if (!sourceLang || sourceLang === TARGET_LANG) return null;
    if (unavailableSet.has(sourceLang)) return null;
    if (translatorCache.has(sourceLang)) return translatorCache.get(sourceLang);
    if (creatingPromises.has(sourceLang)) return creatingPromises.get(sourceLang);

    const promise = createAndCache(sourceLang);
    creatingPromises.set(sourceLang, promise);
    return promise;
  }

  async function tryTranslate(sourceLang, text) {
    const translator = await getTranslatorFor(sourceLang);
    if (!translator) return null;
    try {
      return await translator.translate(text);
    } catch (e) {
      // translator インスタンスが無効化された可能性があるのでキャッシュから破棄し、
      // 次回呼び出しで再作成されるよう自己修復する。
      translatorCache.delete(sourceLang);
      log.debug("翻訳失敗:", sourceLang, e?.message);
      return null;
    }
  }

  async function translateOne(text) {
    const candidates = await detectSources(text);
    for (const src of candidates) {
      const result = await tryTranslate(src, text);
      if (result !== null) return result;
    }
    // 検出失敗・全候補 unavailable の場合、Latin 系短文のみ "en" で最終試行。
    if (shouldFallbackToEn(text) && !candidates.includes("en")) {
      const result = await tryTranslate("en", text);
      if (result !== null) return result;
    }
    return text;
  }

  Base.chromeTranslator = {
    translate(text) {
      return translateOne(text);
    },
    async translateBatch(texts) {
      const results = [];
      for (const text of texts) {
        results.push(await translateOne(text));
      }
      return results;
    },
  };
})(UbyeBase);
