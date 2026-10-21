// Sign-confirmation state machine — a port of the notebook's letter / word / tutor logic.
(function (root) {
  const CFG = {
    CONF: 0.60,          // min confidence for a letter
    STAB: 4,             // frames the same prediction must repeat
    HOLD: 1.5,           // seconds to hold a letter before it is added
    WORD_CONF: 0.85,     // min confidence for a word sign
    WORD_HOLD: 0.6,      // seconds to hold a word before it is added
    CORRECT_FRAMES: 15,  // tutor: frames of a correct sign for "good job"
  };
  const TUTOR_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  function pushStable(buf, v) {
    buf.push(v);
    if (buf.length > CFG.STAB) buf.shift();
    if (buf.length === CFG.STAB && buf.every(x => x === buf[0])) return buf[0];
    return null;
  }

  function createSession() {
    const s = {
      mode: 'letter',
      currentWord: [], words: [],
      current: null, stable: null, confidence: 0,
      holdStart: null, holdLetter: null, lastConfirmed: null, holdProgress: 0,
      status: 'Ready — show a sign to the camera',
      distance: 'ok',
      tutorTarget: 'A', correctFrames: 0, tutorDone: false,
      buf: [], wbuf: [],
    };

    function resetHold() { s.holdStart = null; s.holdLetter = null; s.holdProgress = 0; }
    function resetBuffers() { s.buf.length = 0; s.wbuf.length = 0; }

    function commitLetter(letter, ev) {
      if (letter === 'space') {
        if (s.currentWord.length) {
          const w = s.currentWord.join('');
          s.words.push(w); s.currentWord = [];
          s.status = 'Word: ' + w; ev.translate = true;
        }
      } else if (letter === 'del') {
        if (s.currentWord.length) {
          const r = s.currentWord.pop(); s.status = 'Deleted: ' + r;
        } else if (s.words.length) {
          s.currentWord = Array.from(s.words.pop()); s.status = 'Restored last word';
        }
      } else {
        s.currentWord.push(letter); s.status = '✓ Added letter: ' + letter;
      }
    }

    function confirm(label, holdSecs, onCommit, ev, now) {
      if (s.holdLetter !== label || s.holdStart === null) {
        s.holdStart = now; s.holdLetter = label; s.lastConfirmed = null;
      }
      const held = (now - s.holdStart) / 1000;
      s.holdProgress = Math.min(held / holdSecs, 1);
      if (held >= holdSecs && s.lastConfirmed !== label) {
        onCommit(label, ev);
        s.lastConfirmed = label; s.holdLetter = null; s.holdStart = null; s.holdProgress = 0;
        return true;
      }
      return false;
    }

    // h = { letter: {label, confidence}, word: {label, confidence}, distance }
    function update(h, now) {
      const ev = { translate: false };
      s.distance = h.distance || 'ok';

      if (s.mode === 'letter') {
        const L = h.letter;
        if (L && L.confidence >= CFG.CONF) {
          s.current = L.label; s.confidence = L.confidence;
          const stable = pushStable(s.buf, L.label);
          s.stable = stable;
          if (stable) {
            s.status = 'Hold still: ' + stable;
            if (confirm(stable, CFG.HOLD, commitLetter, ev, now)) s.buf.length = 0;
          } else {
            resetHold(); s.status = 'Keep still... (' + L.label + ')';
          }
        } else {
          s.current = null; s.stable = null; s.confidence = 0; s.buf.length = 0; resetHold();
        }
      } else if (s.mode === 'word') {
        const W = h.word;
        if (W) { s.current = W.label; s.confidence = W.confidence; }
        if (W && W.confidence >= CFG.WORD_CONF) {
          const stable = pushStable(s.wbuf, W.label);
          s.stable = stable;
          if (stable) {
            s.status = 'Hold word: ' + stable;
            const done = confirm(stable, CFG.WORD_HOLD, (w, e) => {
              s.words.push(w); s.currentWord = []; e.translate = true;
              s.status = '✓ Added word: ' + w;
            }, ev, now);
            if (done) s.wbuf.length = 0;
          } else {
            resetHold(); s.status = 'Keep still... (' + W.label + ')';
          }
        } else { resetHold(); s.stable = null; }
      } else { // tutor
        const L = h.letter;
        if (L && L.confidence >= CFG.CONF) {
          s.current = L.label; s.confidence = L.confidence;
          if (L.label === s.tutorTarget) {
            s.correctFrames++; s.status = 'Correct! You signed ' + s.tutorTarget;
          } else {
            s.correctFrames = 0; s.status = 'Try ' + s.tutorTarget + ' — detected ' + L.label;
          }
          s.tutorDone = s.correctFrames >= CFG.CORRECT_FRAMES;
        } else {
          s.current = null; s.confidence = 0; s.correctFrames = 0; s.tutorDone = false;
          s.status = 'Show letter ' + s.tutorTarget;
        }
      }
      return ev;
    }

    function noHand() {
      s.current = null; s.stable = null; s.confidence = 0;
      resetHold(); resetBuffers();
      s.distance = 'ok'; s.correctFrames = 0; s.tutorDone = false;
      s.status = 'No hand detected';
    }

    return {
      state: s,
      update, noHand,
      setMode(m) {
        s.mode = m; s.current = null; s.stable = null; s.confidence = 0;
        resetHold(); resetBuffers(); s.correctFrames = 0; s.tutorDone = false;
        s.lastConfirmed = null;
        s.status = m === 'tutor' ? 'Tutor mode — match the guide for ' + s.tutorTarget
          : 'Switched to ' + m.toUpperCase() + ' mode';
      },
      addSpace() { const ev = { translate: false }; commitLetter('space', ev); return ev; },
      backspace() {
        const ev = { translate: false };
        if (s.currentWord.length) {
          s.status = 'Deleted: ' + s.currentWord.pop(); s.lastConfirmed = null; resetHold(); s.buf.length = 0;
        } else if (s.words.length) {
          s.status = 'Deleted word: ' + s.words.pop(); ev.translate = true;
        }
        return ev;
      },
      clear() {
        s.currentWord = []; s.words = []; s.current = null; s.stable = null;
        s.lastConfirmed = null; resetHold(); resetBuffers(); s.correctFrames = 0; s.tutorDone = false;
        s.status = 'Cleared!';
      },
      nextTutor() {
        const i = TUTOR_LETTERS.indexOf(s.tutorTarget);
        s.tutorTarget = TUTOR_LETTERS[(i + 1) % TUTOR_LETTERS.length];
        s.correctFrames = 0; s.tutorDone = false;
        s.status = 'Show letter ' + s.tutorTarget;
      },
      setTutor(letter) {
        if (TUTOR_LETTERS.includes(letter)) { s.tutorTarget = letter; s.correctFrames = 0; s.tutorDone = false; }
      },
      fullEnglish() {
        const cw = s.currentWord.join('');
        return (s.words.join(' ') + (cw ? ' ' + cw : '')).trim();
      },
    };
  }

  const api = { CFG, TUTOR_LETTERS, createSession };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SignLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
