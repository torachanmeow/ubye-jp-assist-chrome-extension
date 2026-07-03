// Web Speech API のラッパー。interim/final 判定、重複検知、自動再起動を担当。
// 雑音・BGM 下では無音ベースのエンドポインタが発火せず final が来ない・遅れるため、
// 認識セッションを中断 (abort) せずソフトウェア側で確定を行う方式を採る:
//   1. プレフィックス確定: interim の先頭部分が AGREE_WINDOW_MS 変化しなければその部分だけ確定
//   2. 全体確定: interim 全体が STABLE_MS 変化しなければ全体を確定
//   3. 強制確定: 未確定テキストが FORCE_COMMIT_MS を超えて滞留したら無条件に確定
//   4. 無音確定: offscreen の RMS 監視が発話の谷を検出したら flushAtSilence() で確定し、
//      開きっぱなしのセグメントを再起動する（無音中の abort は音声を失わない）
// 確定後もセッションは継続し、確定済み部分を差し引いた残りを interim として扱う。
// 上記の確定（認識器自身の final も含む）はすべて出力バッファに集約し、発話が OUT_GAP_MS 途切れた時
// （または OUT_MAX_MS 到達時）に 1 行としてまとめて送出する。これで表示行の粒度を、認識器が細かく出す
// final の区切りから切り離す。
// 認識器がセグメントを開いたまま固まる（音声が鳴っているのにテキストが進まない）場合は
// 進捗ベースの死活判定 (DEAD_DETECT_MS) が abort で復帰させる。
(function (Base) {
  // --- 確定（コミット）関連 ---
  const STABLE_MS = 5000;             // interim 全体がこの時間無変化なら全確定（出力バッファへ）。表示行の区切りは OUT_GAP_MS が決めるので、これは内部確定のバックストップ
  const AGREE_WINDOW_MS = 2000;       // interim の先頭部分がこの時間変化しなければ「安定」とみなしプレフィックス確定の対象にする。短いほど確定が速いが、認識器の言い直し（改訂）を拾いやすい
  const PREFIX_COMMIT_MIN_INTERVAL_MS = 5000; // 連続発話中に interim の安定した先頭を出力バッファへ移す最小間隔（内部確定のカデンス。表示行の区切りは OUT_GAP_MS）
  const FORCE_COMMIT_MS = 10000;      // 未確定テキストがこの時間滞留したら揺れていても強制確定（「永遠に完了しない」防止の安全弁）
  // --- 出力（表示行）のマージ関連 ---
  const OUT_GAP_MS = 2000;            // ① 確定テキストを1行として送出する前に待つ「発話の途切れ」時間。この間に発話が再開すれば同じ行に繋げる（認識器が細かく出す final をまとめる）。短いほどすぐ送出（細切れ）、長いほどまとまるが送出が遅れる
  const OUT_MAX_MS = 12000;           // ③ 1行の最大蓄積時間。途切れずに話し続けても、この時間で一旦送出する（行が無限に伸びるのを防ぐ安全弁）
  // --- 重複検知関連 ---
  const DEDUPE_HISTORY = 5;           // 完全一致の重複判定に使う確定行の履歴数
  const OVERLAP_TRIM_MIN_LEN = 10;    // 重複トリム判定を行う最低文字数。これ以下の短文は誤トリム防止のため対象外
  const OVERLAP_TRIM_RATIO = 0.6;     // 直前の確定行との重複率（短い方基準）がこれを超えたら、重複部分を削って差分のみ出力
  // --- スタック検知関連 ---
  const DEAD_DETECT_MS = 6000;        // 音声が鳴っているのにテキストが進まない状態をスタックとみなし abort で復帰させるまでの時間。短いほど復帰が速いが、発話の合間の正常な無進捗でも再起動が走る
  const AUDIO_RECENT_MS = 2000;       // 「音声が鳴っている」とみなす RMS 検出からの猶予時間（これより古ければ無音扱いでスタック判定しない）
  const DEAD_CHECK_INTERVAL_MS = 2000; // スタック判定の実行間隔

  Base.createSttEngine = function (options) {
    const broadcast = options.onBroadcast;

    let recognition = null;
    let status = "idle";
    let manualStop = false;
    let lastFinals = [];
    let wantRestart = false;
    let audioTrack = null;
    let restartCount = 0;
    let restartWindowStart = 0;
    const RESTART_LIMIT = 5;        // RESTART_WINDOW_MS 内の自動再起動回数の上限。超えたら異常とみなしエラー停止（無限再起動ループ防止）
    const RESTART_WINDOW_MS = 5000; // 再起動回数をカウントする時間窓
    let lastProgressTs = 0; // interim の変化 or final を最後に観測した時刻（スタック検知用）
    let lastAudioActiveTs = 0;
    let deadCheckTimer = null;
    let intentionalAbort = false; // flush/無音/スタック復帰など、こちらの意図で abort した直後だけ true（クラッシュ再起動と区別し再起動上限にカウントしない）

    // --- 現在の認識セグメント（open な result）の確定管理 ---
    let lastInterim = "";   // セグメントの interim 全文
    let committedText = ""; // うち final として確定済みの先頭部分
    let interimLog = [];    // 直近の interim 履歴 [{ text, ts }]（プレフィックス安定判定用）
    let pendingSince = 0;   // 未確定テキストが滞留し始めた時刻（強制確定用）
    let lastCommitTs = 0;   // 最後にプレフィックス確定した時刻（確定間隔の時間制御用）
    let stableTimer = null;

    function resetSegment() {
      lastInterim = "";
      committedText = "";
      interimLog = [];
      pendingSince = 0;
      lastCommitTs = 0;
      clearTimeout(stableTimer); stableTimer = null;
    }

    // --- 出力（表示行）のマージ層: 確定済みテキストを貯め、発話の途切れ(OUT_GAP_MS)で1行として送出する。
    //     セグメント(認識器の result)をまたいで蓄積するため resetSegment では消さない。 ---
    let outBuffer = "";     // 送出待ちの確定済みテキスト
    let outFirstTs = 0;     // outBuffer に最初に積んだ時刻（OUT_MAX_MS 判定用）
    let outGapTimer = null; // 発話の途切れ検出タイマー

    function resetOutput() {
      outBuffer = "";
      outFirstTs = 0;
      clearTimeout(outGapTimer); outGapTimer = null;
    }

    function pokeAudioActive() {
      lastAudioActiveTs = Date.now();
    }

    function startDeadCheck() {
      stopDeadCheck();
      lastProgressTs = Date.now();
      lastAudioActiveTs = 0;
      deadCheckTimer = setInterval(() => {
        if (status !== "listening") return;
        const now = Date.now();
        if (now - lastAudioActiveTs > AUDIO_RECENT_MS) return;
        if (now - lastProgressTs < DEAD_DETECT_MS) return;
        try { intentionalAbort = true; recognition.abort(); } catch (_) { intentionalAbort = false; }
      }, DEAD_CHECK_INTERVAL_MS);
    }

    function stopDeadCheck() {
      clearInterval(deadCheckTimer);
      deadCheckTimer = null;
    }

    function setStatus(s) {
      if (status === s) return;
      status = s;
      broadcast("status", { status: s });
    }

    function commonPrefixLen(a, b) {
      const n = Math.min(a.length, b.length);
      let i = 0;
      while (i < n && a[i] === b[i]) i++;
      return i;
    }

    function suffixPrefixOverlap(a, b) {
      const maxLen = Math.min(a.length, b.length);
      let best = 0;
      for (let len = 1; len <= maxLen; len++) {
        if (a.endsWith(b.slice(0, len))) best = len;
      }
      return best;
    }

    // committedText を差し引いた未確定部分を返す
    function uncommittedPart(text) {
      if (!committedText) return text;
      if (text.startsWith(committedText)) return text.slice(committedText.length);
      // 認識器が確定済み領域を改訂した場合: 一致する共通プレフィックスまでを確定済みとして差し引き、
      // 既に送出済みの先頭部分を二重に出さないようにする。
      return text.slice(commonPrefixLen(committedText, text));
    }

    // ラテン系は語間に空白を入れ、CJK 等は詰めて連結する（言語非依存）
    function joinText(a, b) {
      if (!a) return b;
      if (!b) return a;
      return /[A-Za-z0-9)\]]$/.test(a) ? a + " " + b : a + b;
    }

    // 確定済み(outBuffer) ＋ 未確定(interim) を合わせた「進行中の全文」を interim として表示する。
    // マージ待ちで貯めている確定済み部分が画面から消えないようにする。
    function broadcastInterim() {
      broadcast("interim", { text: joinText(outBuffer, uncommittedPart(lastInterim)) });
    }

    function scheduleOutFlush() {
      clearTimeout(outGapTimer);
      outGapTimer = setTimeout(onSpeechGap, OUT_GAP_MS);
    }

    // 内部確定（プレフィックス/全体/強制/無音/認識器 final）はすべてここへ集約し、即送出せず貯める。
    // 行の区切りは発生源（特に認識器の細かい final）ではなく、発話の途切れ・上限時間だけで決める。
    function appendOutput(text) {
      const t = text.trim();
      if (!t) return;
      const now = Date.now();
      if (!outBuffer) { outBuffer = t; outFirstTs = now; }
      else outBuffer = joinText(outBuffer, t);
      if (now - outFirstTs >= OUT_MAX_MS) flushOutput(); // ③ 上限時間で強制送出
      else scheduleOutFlush();                            // ① 途切れたら送出
    }

    // 貯めた確定テキストを 1 行として送出する（重複検知・オーバーラップトリムはここで実施）。
    function flushOutput() {
      clearTimeout(outGapTimer); outGapTimer = null;
      let trimmed = outBuffer.trim();
      outBuffer = "";
      outFirstTs = 0;
      if (!trimmed) return;
      if (lastFinals.includes(trimmed)) return;
      // 直近の確定行と先頭が大きく重複している場合は差分のみを出す（全破棄すると続きが失われる）
      const prev = lastFinals[lastFinals.length - 1];
      if (prev) {
        const shorter = Math.min(prev.length, trimmed.length);
        if (shorter > OVERLAP_TRIM_MIN_LEN) {
          const overlap = suffixPrefixOverlap(prev, trimmed);
          if (overlap / shorter > OVERLAP_TRIM_RATIO) {
            trimmed = trimmed.slice(overlap).trim();
            if (!trimmed || lastFinals.includes(trimmed)) return;
          }
        }
      }
      lastFinals.push(trimmed);
      if (lastFinals.length > DEDUPE_HISTORY) lastFinals.shift();
      broadcast("final", { text: trimmed });
    }

    // 発話が OUT_GAP_MS 途切れた = 行の区切り。未確定の末尾も確定してから 1 行として送出する。
    function onSpeechGap() {
      outGapTimer = null;
      flushPending();   // 未確定の末尾を outBuffer へ移す
      flushOutput();    // 貯めた分を 1 行として送出
      broadcastInterim();
    }

    // 未確定テキストを出力バッファへ確定する。認識セッションは継続する。
    function flushPending() {
      clearTimeout(stableTimer); stableTimer = null;
      if (!lastInterim) return;
      const rest = uncommittedPart(lastInterim).trim();
      if (!rest) return;
      committedText = lastInterim;
      pendingSince = 0;
      lastCommitTs = Date.now();
      interimLog = []; // フラッシュ済みの古い履歴を残すと AGREE ウィンドウ判定が早まるためクリア
      appendOutput(rest);
      broadcastInterim();
    }

    // 無音区間（offscreen の RMS 監視が検出した発話の谷）で呼ばれる。
    // 未確定分を確定した上で、開きっぱなしのセグメントを abort で再起動し、
    // 次の発話に認識器が即応できる状態へ戻す。無音中なので音声の取りこぼしはない。
    function flushAtSilence() {
      const hadSegment = !!lastInterim;
      flushPending();
      flushOutput(); // 無音は明確な発話の区切り → 貯めた行を送出
      if (hadSegment && status === "listening") {
        try { intentionalAbort = true; recognition.abort(); } catch (_) { intentionalAbort = false; }
      }
    }

    function resetStableTimer() {
      clearTimeout(stableTimer);
      stableTimer = setTimeout(flushPending, STABLE_MS);
    }

    // AGREE_WINDOW_MS の間変化していない interim の先頭部分を final として確定する
    function evaluatePrefixCommit(now) {
      if (pendingSince && now - pendingSince >= FORCE_COMMIT_MS) {
        flushPending();
        return;
      }
      const cutoff = now - AGREE_WINDOW_MS;
      // ウィンドウ境界より古いエントリを 1 つだけ残して間引く
      while (interimLog.length >= 2 && interimLog[1].ts <= cutoff) interimLog.shift();
      if (interimLog.length < 2 || interimLog[0].ts > cutoff) return;
      let plen = interimLog[0].text.length;
      for (let i = 1; i < interimLog.length; i++) {
        plen = Math.min(plen, commonPrefixLen(interimLog[0].text, interimLog[i].text));
        if (plen === 0) return;
      }
      const stable = interimLog[interimLog.length - 1].text.slice(0, plen);
      if (!stable.startsWith(committedText)) return; // 確定済み領域が改訂中なら見送る
      let chunk = stable.slice(committedText.length);
      // ラテン系で語の途中で切らないよう、空白があれば最後の空白で区切る
      const lastSpace = chunk.lastIndexOf(" ");
      if (lastSpace > 0) chunk = chunk.slice(0, lastSpace);
      if (!chunk.trim()) return;
      // 直前の確定から十分間隔が空くまで待ち、安定した分をまとめて出力バッファへ移す（時間ベース・言語非依存）
      if (now - lastCommitTs < PREFIX_COMMIT_MIN_INTERVAL_MS) return;
      committedText += chunk;
      lastCommitTs = now;
      pendingSince = now;
      appendOutput(chunk);
    }

    function handleInterimResult(transcript, now) {
      if (transcript !== lastInterim) {
        lastProgressTs = now;
        lastInterim = transcript;
        interimLog.push({ text: transcript, ts: now });
        if (!pendingSince && uncommittedPart(transcript).trim()) {
          pendingSince = now;
          // 段の開始時刻を確定間隔の起点にする。これがないと開始直後（lastCommitTs=0）は
          // 間隔ゲートが素通りし、途中参加した文の中途半端な短片が即確定・即翻訳されてしまう。
          if (!lastCommitTs) lastCommitTs = now;
        }
        resetStableTimer();
        evaluatePrefixCommit(now);
        scheduleOutFlush(); // 発話が続く限り送出を先送り。途切れたら onSpeechGap が送出する
      }
      broadcastInterim();
    }

    function handleFinalResult(transcript, now) {
      lastProgressTs = now;
      const rest = uncommittedPart(transcript).trim();
      resetSegment();
      if (rest) appendOutput(rest); // 認識器の final も即送出せずマージ層へ
      broadcastInterim();
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

      recognition.onstart = () => {
        setStatus("listening");
        startDeadCheck();
      };

      recognition.onresult = (event) => {
        const now = Date.now();
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript.trim();
          if (!transcript) continue;
          if (result.isFinal) {
            handleFinalResult(transcript, now);
          } else {
            handleInterimResult(transcript, now);
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
        stopDeadCheck();
        // 残っている未確定分を確定してからセグメントを破棄する
        flushPending();
        resetSegment();
        if (manualStop) {
          flushOutput(); // 停止時は貯めた分を送出（再起動・クラッシュ復帰では送出せず蓄積を継続する）
          setStatus("idle");
          if (wantRestart) {
            wantRestart = false;
            start();
          }
          return;
        }
        // 無音確定・スタック復帰など、こちらの意図で abort した場合は正常動作なので
        // 再起動上限にカウントせず即再開する（クラッシュ由来の連続再起動のみ上限で止める）。
        if (intentionalAbort) {
          intentionalAbort = false;
          recognition = null;
          initRecognition();
          setStatus("starting");
          startRecognition();
          return;
        }
        const now = Date.now();
        if (now - restartWindowStart > RESTART_WINDOW_MS) {
          restartCount = 0;
          restartWindowStart = now;
        }
        restartCount++;
        if (restartCount > RESTART_LIMIT) {
          restartCount = 0;
          restartWindowStart = 0;
          manualStop = true;
          setStatus("error");
          broadcast("error", { error: "too-many-restarts", fatal: true });
          return;
        }
        recognition = null;
        initRecognition();
        setStatus("starting");
        startRecognition();
      };

      return true;
    }

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

    function start() {
      if (status === "listening" || status === "starting") return;
      if (status === "stopping") {
        wantRestart = true;
        return;
      }
      wantRestart = false;
      restartCount = 0;
      restartWindowStart = 0;
      intentionalAbort = false;
      if (!recognition) {
        if (!initRecognition()) return;
      }
      recognition.lang = options.lang;
      manualStop = false;
      lastFinals = [];
      resetSegment();
      resetOutput();
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
      stopDeadCheck();
      flushPending();
      flushOutput(); // 貯めた分を送出してから停止
      resetSegment();
      if (status === "idle") return;
      setStatus("stopping");
      try { recognition.stop(); } catch (_) {}
    }

    function getStatus() {
      return status;
    }

    return { start, stop, restart, getStatus, setLang, setAudioTrack, pokeAudioActive, flushAtSilence };
  };
})(UbyeBase);
