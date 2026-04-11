// 拡張内メッセージ通信のプロトコル型定数を一元定義。
(function (Base) {
  Base.MSG = {
    // 翻訳
    TRANSLATE_SEND: "translateSend",
    TRANSLATE_SPEECH: "translateSpeech",
    TRANSLATE_BATCH: "translateBatch",
    // STT offscreen コマンド（background ↔ offscreen）
    STT_CMD: "stt-cmd",
    STT_BROADCAST: "stt-broadcast",
    // STT 制御（popup / content script → background）
    STT_START_CAPTURE: "stt-start-capture",
    STT_STOP_CAPTURE: "stt-stop-capture",
    STT_GET_CAPTURE_TAB: "stt-get-capture-tab",
    // STT オーバーレイ（background → content script）
    STT_OVERLAY: "stt-overlay",
    // STT キャプチャ停止通知（background → popup）
    STT_CAPTURE_STOPPED: "stt-capture-stopped",
    // STT ログクリア（popup → content script）
    STT_CLEAR_LOG: "stt-clear-log",
    // トースト通知（background → content script）
    TOAST: "toast",
    // offscreen 準備完了
    OFFSCREEN_READY: "offscreen-ready",
  };
})(UbyeBase);
