// Gemini API による翻訳プロバイダ実装。単文翻訳とバッチ翻訳、JSON パースのフォールバック処理。
(function (Base) {
  const log = Base.log.create("gemini");
  const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

  /** systemPrompt を parts 配列に変換（文字列 or { base, hints } 対応） */
  function buildSystemParts(systemPrompt) {
    if (typeof systemPrompt === "string") return [{ text: systemPrompt }];
    const parts = [{ text: systemPrompt.base }];
    if (systemPrompt.hints) parts.push({ text: systemPrompt.hints });
    return parts;
  }

  const RETRY_STATUSES = new Set([429, 503]);
  const RETRY_DELAY_MS = 1000;

  async function callGeminiApi(apiKey, model, systemPrompt, text, maxTokens, retried) {
    if (!Base.GEMINI_MODELS.some((m) => m.value === model)) {
      throw new Error(`不正なモデル値です: ${model}`);
    }
    const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        systemInstruction: { parts: buildSystemParts(systemPrompt) },
        generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
      }),
    });
    if (!res.ok) {
      if (!retried && RETRY_STATUSES.has(res.status)) {
        log.debug("リトライ:", res.status);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return callGeminiApi(apiKey, model, systemPrompt, text, maxTokens, true);
      }
      if (res.status === 400) throw new Error("APIリクエストが不正です（API Keyまたはパラメータを確認してください）");
      if (res.status === 403) throw new Error("API Keyが無効、または権限がありません");
      if (res.status === 404) throw new Error("モデルが見つかりません。設定でモデルを変更してください");
      if (res.status === 429) throw new Error("APIレート制限中です。しばらくお待ちください");
      throw new Error(`API エラー (${res.status})`);
    }
    const data = await res.json();
    const translated = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (translated) return trimRepeat(translated.trim());
    throw new Error("翻訳結果が空です");
  }

  /** 同一フレーズの異常な繰り返しを除去する */
  function trimRepeat(text) {
    // 3〜30文字のフレーズが5回以上連続していたらループとみなし、1回だけ残す
    const replaced = text.replace(/(.{3,30}?)\1{4,}/g, "$1");
    if (replaced !== text) log.debug("繰り返し除去:", text.length, "→", replaced.length);
    return replaced;
  }

  /** パース済み配列を元テキスト配列にマッピング（型が合わない要素は元テキストで補完） */
  function mapParsedArray(parsed, texts) {
    return texts.map((orig, i) => {
      const t = parsed[i];
      return typeof t === "string" ? t : orig;
    });
  }

  const GeminiProvider = {
    name: "gemini",

    async translate(systemPrompt, text, options = {}) {
      const { apiKey, model = Base.DEFAULT_GEMINI_MODEL, maxTokens = 512 } = options;
      if (!apiKey) throw new Error("API Keyが未設定です");
      return callGeminiApi(apiKey, model, systemPrompt, "[Translate]\n" + text, maxTokens);
    },

    async translateBatch(systemPrompt, texts, options = {}) {
      const { apiKey, model = Base.DEFAULT_GEMINI_MODEL } = options;
      if (!apiKey) throw new Error("API Keyが未設定です");
      const inputTokenEstimate = texts.reduce((sum, t) => sum + t.length, 0);
      const maxTokens = Math.max(512, Math.ceil(inputTokenEstimate * 1.5) + texts.length * 30);

      const basePrompt = typeof systemPrompt === "string" ? systemPrompt
        : [systemPrompt.base, systemPrompt.hints].filter(Boolean).join("\n");
      const jsonPrompt = basePrompt +
        "\n\nIMPORTANT: The input is a JSON array of strings. " +
        "You MUST return a JSON array of the same length with only the translated strings. " +
        "Do NOT output plain text, markdown, or any other format. Output ONLY a valid JSON array.";
      const input = JSON.stringify(texts);
      const raw = await callGeminiApi(apiKey, model, jsonPrompt, input, maxTokens);

      // JSON パース試行（マークダウンコードブロック除去 → JSON配列抽出）
      const cleaned = raw.replace(/^```json?\s*|```\s*$/g, "").trim();
      const jsonStr = cleaned.startsWith("[") ? cleaned : (cleaned.match(/\[[\s\S]*\]/) || [])[0];
      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) return mapParsedArray(parsed, texts);
        } catch {
          // JSON が途中で切断された場合: 最後の不完全な要素を除去して再パース
          const repaired = jsonStr.replace(/,\s*"(?:[^"\\]|\\.)*$/, "]");
          try {
            const parsed = JSON.parse(repaired);
            if (Array.isArray(parsed)) return mapParsedArray(parsed, texts);
          } catch {}
        }
      }

      // --- JSON パース失敗時のフォールバック群 ---
      // 括弧を除去してプレーンテキストとして扱う
      const plain = cleaned.replace(/^\[|\]$/g, "").trim();

      // 改行区切りフォールバック
      const lines = plain.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length >= Math.ceil(texts.length / 2)) {
        log.debug("translateBatch: 改行区切りフォールバック適用", lines.length, "/", texts.length);
        return mapParsedArray(lines, texts);
      }

      // カンマ区切りフォールバック（例: [訳文A, 訳文B, 訳文C]）
      const commaSplit = plain.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
      if (commaSplit.length >= Math.ceil(texts.length / 2)) {
        log.debug("translateBatch: カンマ区切りフォールバック適用", commaSplit.length, "/", texts.length);
        return mapParsedArray(commaSplit, texts);
      }

      // 「」区切りフォールバック（例: 「訳文A」「訳文B」「訳文C」）
      const quoted = [...plain.matchAll(/「([^」]*)」/g)].map((m) => m[1]);
      if (quoted.length >= Math.ceil(texts.length / 2)) {
        log.debug("translateBatch: 「」区切りフォールバック適用", quoted.length, "/", texts.length);
        return mapParsedArray(quoted, texts);
      }

      // 最終フォールバック: 元テキストをそのまま返す
      log.warn("translateBatch: パース失敗、元テキストを返却", raw);
      return texts.slice();
    },
  };

  Base.translationProvider = GeminiProvider;
})(UbyeBase);
