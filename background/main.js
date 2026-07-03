// Service Worker のエントリポイント。依存モジュールを読み込み順に importScripts で登録。
importScripts(
  "../base/namespace.js",
  "../base/message-types.js",
  "../base/translation-gemini.js",
  "../base/config.js",
  "../vendor/opencc-cn2t.js",
  "../base/s2t-convert.js",
  "../profiles.js",
  "stt-tab-manager.js",
  "context-menu.js",
  "message-router.js"
);
