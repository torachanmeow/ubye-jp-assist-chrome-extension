// 翻訳プロバイダのディスパッチャー。モデル設定に応じてローカル（Chrome内蔵）またはバックグラウンド（Gemini）にルーティング。
(function (Base) {
  if (Base.translate) return;
  const MSG = Base.MSG;

  // stt-overlay.js でも同キーを登録（意図的な複数登録、namespace.js の配列管理で両方に通知される）
  const getSpeechModel = Base.createStorageValue("speechModel", Base.DEFAULT_TRANSLATION_MODEL);
  const getChatModel = Base.createStorageValue("chatModel", Base.DEFAULT_TRANSLATION_MODEL);

  const localProviders = {
    chrome() { return Base.chromeTranslator; },
  };

  function resolveLocal(model) {
    const entry = Base.TRANSLATION_MODELS.find((m) => m.value === model);
    if (!entry) return null;
    const factory = localProviders[entry.provider];
    return factory ? factory() : null;
  }

  Base.translate = {
    async speech(text) {
      const provider = resolveLocal(getSpeechModel());
      if (provider) {
        const translatedText = await provider.translate(text);
        return { ok: true, translatedText };
      }
      return Base.sendMsg({ type: MSG.TRANSLATE_SPEECH, text });
    },

    async batch(texts) {
      const provider = resolveLocal(getChatModel());
      if (provider) {
        const translated = await provider.translateBatch(texts);
        return { ok: true, results: translated.map((t) => ({ translatedText: t })) };
      }
      return Base.sendMsg({ type: MSG.TRANSLATE_BATCH, texts });
    },

    send(text) {
      return Base.sendMsg({ type: MSG.TRANSLATE_SEND, text });
    },
  };
})(UbyeBase);
