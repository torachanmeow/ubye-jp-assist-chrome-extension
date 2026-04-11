// 組み込みプロファイルの登録。対応言語ごとの STT 言語コードを定義。
(function (Base) {
  if (Base._profilesLoaded) return; // 動的注入の冪等性ガード
  Base._profilesLoaded = true;

  Base.registerProfile("zh-tw-general", {
    label: "中国語（繁体）",
    sttLang: "zh-TW",
  });

  Base.registerProfile("zh-cn-general", {
    label: "中国語（簡体）",
    sttLang: "zh-CN",
  });

  Base.registerProfile("en-general", {
    label: "英語",
    sttLang: "en-US",
  });

  Base.registerProfile("ko-general", {
    label: "韓国語",
    sttLang: "ko-KR",
  });

  Base.registerProfile("ja-general", {
    label: "日本語",
    sttLang: "ja-JP",
  });

})(UbyeBase);
