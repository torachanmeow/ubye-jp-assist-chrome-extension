// Web Speech API のラッパー。interim/final 判定、重複検知、自動再起動を担当。
(function (Base) {
  const STABLE_MS = 2000;
  const DEDUPE_HISTORY = 5;

  Base.createSttEngine = function (options) {
    const broadcast = options.onBroadcast;

    let recognition = null;
    let status = "idle";
    let manualStop = false;
    let lastFinals = [];
    let lastInterim = "";
    let stableTimer = null;

    function setStatus(s) {
      if (status === s) return;
      status = s;
      broadcast("status", { status: s });
    }

    function suffixPrefixOverlap(a, b) {
      const maxLen = Math.min(a.length, b.length);
      let best = 0;
      for (let len = 1; len <= maxLen; len++) {
        if (a.endsWith(b.slice(0, len))) best = len;
      }
      return best;
    }

    function isDuplicate(text) {
      for (const prev of lastFinals) {
        if (text === prev) return true;
        const shorter = Math.min(text.length, prev.length);
        if (shorter > 10 && suffixPrefixOverlap(prev, text) / shorter > 0.6) return true;
      }
      return false;
    }

    function emitFinal(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (isDuplicate(trimmed)) return;
      lastFinals.push(trimmed);
      if (lastFinals.length > DEDUPE_HISTORY) lastFinals.shift();
      broadcast("final", { text: trimmed });
    }

    function commitInterim() {
      if (!lastInterim) return;
      emitFinal(lastInterim);
      lastInterim = "";
      broadcast("interim", { text: "" });
      try { recognition.abort(); } catch (_) {}
    }

    function resetStableTimer() {
      clearTimeout(stableTimer);
      stableTimer = setTimeout(commitInterim, STABLE_MS);
    }

    function initRecognition() {
      const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Ctor) {
        setStatus("error");
        return false;
      }

      recognition = new Ctor();
      recognition.lang = options.lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setStatus("listening");

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript.trim();
          if (!transcript) continue;
          if (result.isFinal) {
            clearTimeout(stableTimer); stableTimer = null;
            lastInterim = "";
            emitFinal(transcript);
          } else {
            if (transcript !== lastInterim) {
              lastInterim = transcript;
              resetStableTimer();
            }
            broadcast("interim", { text: transcript });
          }
        }
      };

      recognition.onerror = (event) => {
        if (event.error === "aborted" || event.error === "no-speech") return;
        const fatal = event.error === "not-allowed" || event.error === "service-not-allowed";
        if (fatal) {
          setStatus("error");
          manualStop = true;
          wantRestart = false;
        }
        broadcast("error", { error: event.error, fatal });
      };

      recognition.onend = () => {
        clearTimeout(stableTimer); stableTimer = null;
        if (manualStop) {
          setStatus("idle");
          if (wantRestart) {
            wantRestart = false;
            start();
          }
          return;
        }
        if (lastInterim) {
          emitFinal(lastInterim);
          lastInterim = "";
        }
        recognition = null;
        initRecognition();
        setStatus("starting");
        startRecognition();
      };

      return true;
    }

    let audioTrack = null;

    function setLang(lang) {
      options.lang = lang;
    }

    function setAudioTrack(track) {
      audioTrack = track;
    }

    function startRecognition() {
      try {
        recognition.start(audioTrack);
      } catch (e) {
        if (status === "listening") return;
        setStatus("error");
        broadcast("error", { error: e.message, fatal: true });
      }
    }

    let wantRestart = false;

    function start() {
      if (status === "listening" || status === "starting") return;
      if (status === "stopping") {
        wantRestart = true;
        return;
      }
      wantRestart = false;
      if (!recognition) {
        if (!initRecognition()) return;
      }
      recognition.lang = options.lang;
      manualStop = false;
      lastFinals = [];
      lastInterim = "";
      startRecognition();
    }

    function restart() {
      if (status === "idle" || status === "error") {
        if (!audioTrack) return;
        start();
        return;
      }
      stop();
      wantRestart = true;
    }

    function stop() {
      wantRestart = false;
      manualStop = true;
      clearTimeout(stableTimer); stableTimer = null;
      if (lastInterim) {
        emitFinal(lastInterim);
        lastInterim = "";
      }
      if (status === "idle") return;
      setStatus("stopping");
      try { recognition.stop(); } catch (_) {}
    }

    function getStatus() {
      return status;
    }

    return { start, stop, restart, getStatus, setLang, setAudioTrack };
  };
})(UbyeBase);
