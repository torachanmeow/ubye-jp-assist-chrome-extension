// Offscreen document。tabCapture の音声ストリームを受け取り、SpeechRecognition を実行。
const Base = UbyeBase;
const MSG = Base.MSG;
const log = Base.log.create("offscreen");

const engine = Base.createSttEngine({
  lang: Base.sttLang,
  onBroadcast(subtype, data) {
    chrome.runtime.sendMessage({ type: MSG.STT_BROADCAST, subtype, ...data }).catch((e) => log.debug("msg dropped:", e.message));
  },
});

let audioCtx = null;
let capturedStream = null;
let startingPromise = null;
let audioAnalyser = null;
let audioAnalyserBuf = null;
let audioMonitorTimer = null;
const AUDIO_RMS_THRESHOLD = 0.005;
const AUDIO_MONITOR_INTERVAL_MS = 500;

function startAudioMonitor() {
  stopAudioMonitor();
  if (!audioAnalyser) return;
  audioMonitorTimer = setInterval(() => {
    if (!audioAnalyser) return;
    audioAnalyser.getFloatTimeDomainData(audioAnalyserBuf);
    let sum = 0;
    for (let i = 0; i < audioAnalyserBuf.length; i++) sum += audioAnalyserBuf[i] * audioAnalyserBuf[i];
    const rms = Math.sqrt(sum / audioAnalyserBuf.length);
    if (rms > AUDIO_RMS_THRESHOLD) engine.pokeAudioActive();
  }, AUDIO_MONITOR_INTERVAL_MS);
}

function stopAudioMonitor() {
  clearInterval(audioMonitorTimer);
  audioMonitorTimer = null;
}

async function startWithStream(streamId) {
  if (startingPromise) await startingPromise;
  stopStream();
  startingPromise = (async () => {
  try {
    capturedStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    });
    audioCtx = new AudioContext();
    const sourceNode = audioCtx.createMediaStreamSource(capturedStream);
    sourceNode.connect(audioCtx.destination);
    audioAnalyser = audioCtx.createAnalyser();
    audioAnalyser.fftSize = 1024;
    audioAnalyserBuf = new Float32Array(audioAnalyser.fftSize);
    sourceNode.connect(audioAnalyser);

    const audioTrack = capturedStream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("音声トラックが取得できません");
    audioTrack.onended = () => {
      chrome.runtime.sendMessage({
        type: MSG.STT_CMD, cmd: "stream-ended",
      }).catch((e) => log.debug("msg dropped:", e.message));
    };
    engine.setAudioTrack(audioTrack);
    engine.start();
    startAudioMonitor();
  } catch (e) {
    chrome.runtime.sendMessage({
      type: MSG.STT_BROADCAST, subtype: "error",
      error: "tabCapture: " + e.message, fatal: true,
    }).catch((e) => log.debug("msg dropped:", e.message));
  }
  })();
  await startingPromise;
  startingPromise = null;
}

function stopStream() {
  stopAudioMonitor();
  engine.stop();
  engine.setAudioTrack(null);
  if (capturedStream) {
    for (const track of capturedStream.getTracks()) track.stop();
    capturedStream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch((e) => log.debug("msg dropped:", e.message));
    audioCtx = null;
  }
  audioAnalyser = null;
  audioAnalyserBuf = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== MSG.STT_CMD) return;
  if (msg.cmd === "start-with-stream" && msg.streamId) {
    if (msg.config) Base.applyProfile(msg.config.profile);
    engine.setLang(Base.sttLang);
    startWithStream(msg.streamId);
  } else if (msg.cmd === "stop") {
    stopStream();
  } else if (msg.cmd === "get-status") {
    chrome.runtime.sendMessage({
      type: MSG.STT_BROADCAST, subtype: "status", status: engine.getStatus(),
    }).catch((e) => log.debug("msg dropped:", e.message));
  } else if (msg.cmd === "update-config") {
    if (msg.profile) Base.applyProfile(msg.profile);
    engine.setLang(Base.sttLang);
    if (msg.restart) engine.restart();
  }
});

chrome.runtime.sendMessage({ type: MSG.OFFSCREEN_READY }).catch((e) => log.debug("msg dropped:", e.message));
