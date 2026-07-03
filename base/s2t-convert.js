// 簡体字→繁体字の変換。zh-TW プロファイル時のみ OpenCC を使用。
(function (Base) {
  let _converter = null;

  Base.convertS2T = function (text) {
    if (!text || typeof OpenCC === "undefined") return text;
    if (!_converter) {
      _converter = OpenCC.Converter({ from: "cn", to: "tw" });
    }
    return _converter(text);
  };

  Base.needsS2T = function () {
    return Base.sttLang === "zh-TW";
  };

  Base.applyS2T = function (text) {
    return Base.needsS2T() ? Base.convertS2T(text) : text;
  };
})(UbyeBase);
