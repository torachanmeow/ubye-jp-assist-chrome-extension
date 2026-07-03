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
const AUDIO_RMS_THRESHOLD = 0.005;     // 音声帯域の RMS がこれを超えたら「音が鳴っている」とみなす。上げると小音量を無音扱い、下げるとノイズにも反応
const AUDIO_MONITOR_INTERVAL_MS = 150; // RMS 監視の実行間隔。無音検出の分解能を決める（SILENCE_FLUSH_MS より十分小さくすること）
const SILENCE_FLUSH_MS = 5000;         // 無音がこの時間続いたら未確定分を確定しセグメントを再起動して次の発話に備える（認識器のリフレッシュ目的。表示行の区切りはエンジン側 OUT_GAP_MS が担う）
let lastRmsActiveTs = 0;
let silenceFlushed = true;

function startAudioMonitor() {
  stopAudioMonitor();
  if (!audioAnalyser) return;
  lastRmsActiveTs = 0;
  silenceFlushed = true;
  audioMonitorTimer = setInterval(() => {
    if (!audioAnalyser) return;
    audioAnalyser.getFloatTimeDomainData(audioAnalyserBuf);
    let sum = 0;
    for (let i = 0; i < audioAnalyserBuf.length; i++) sum += audioAnalyserBuf[i] * audioAnalyserBuf[i];
    const rms = Math.sqrt(sum / audioAnalyserBuf.length);
    const now = Date.now();
    if (rms > AUDIO_RMS_THRESHOLD) {
      engine.pokeAudioActive();
      lastRmsActiveTs = now;
      silenceFlushed = false;
    } else if (!silenceFlushed && lastRmsActiveTs && now - lastRmsActiveTs >= SILENCE_FLUSH_MS) {
      // 音声帯域のエネルギーが途切れた = 発話の区切りとみなして未確定分を確定し、
      // セグメントを再起動して次の発話に即応できる状態へ戻す（無音中なので音声を失わない）。
      // BGM が常時鳴っている配信では谷が出ないため発火せず、エンジン側のタイマー確定と
      // 進捗ベースの死活判定に任せる。
      silenceFlushed = true;
      engine.flushAtSilence();
    }
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
    // 解析パスは人の声の帯域（約300〜3400Hz）に絞り、BGM・効果音の帯域外エネルギーが
    // RMS 判定（死活検知・無音確定）に影響しにくくする。再生パスと認識入力には影響しない。
    const speechHighpass = audioCtx.createBiquadFilter();
    speechHighpass.type = "highpass";
    speechHighpass.frequency.value = 300;
    const speechLowpass = audioCtx.createBiquadFilter();
    speechLowpass.type = "lowpass";
    speechLowpass.frequency.value = 3400;
    audioAnalyser = audioCtx.createAnalyser();
    audioAnalyser.fftSize = 1024;
    audioAnalyserBuf = new Float32Array(audioAnalyser.fftSize);
    sourceNode.connect(speechHighpass);
    speechHighpass.connect(speechLowpass);
    speechLowpass.connect(audioAnalyser);

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
