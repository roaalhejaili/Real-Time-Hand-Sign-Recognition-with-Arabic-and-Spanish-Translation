// Let's Sign — camera, hand tracking, prediction and UI wiring.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const session = SignLogic.createSession();
  const S = session.state;
  const CFG = SignLogic.CFG;

  const el = {
    cam: $('cam'), view: $('view'), stage: $('stage'), gate: $('gate'), start: $('start'),
    loadNote: $('loadNote'), gateErr: $('gateErr'), chip: $('chip'), reading: $('reading'),
    ring: $('ring'), glyph: $('glyph'), pct: $('pct'), banner: $('banner'),
    guide: $('guide'), guideImg: $('guideImg'), guideLetter: $('guideLetter'),
    keys: $('keys'), tutorCard: $('tutorCard'), tutorPick: $('tutorPick'),
    outEn: $('outEn'), outAr: $('outAr'), outEs: $('outEs'), wordList: $('wordList'),
    tabs: Array.from(document.querySelectorAll('.tab')),
  };
  const ctx = el.view.getContext('2d');
  const proc = document.createElement('canvas');
  const pctx = proc.getContext('2d');
  const RING = 2 * Math.PI * 54;

  const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

  // The model was trained on landmarks from un-mirrored photos, so it reads the raw camera frame.
  // Only the on-screen picture is mirrored (selfie view).
  const TRAIN_HAND = 'Left';   // MediaPipe's label for a hand that looks like the training images
  let models = null, hands = null, running = false, busy = false, hadHand = false;

  // ---------------------------------------------------------------- translation
  const DICT = {
    ar: { 'hi': 'مرحبا', 'hello': 'مرحبا', 'good': 'جيد', 'how are you': 'كيف حالك', 'thank you': 'شكرا لك',
          'thanks': 'شكرا', 'computer vision': 'رؤية الحاسوب', 'yes': 'نعم', 'no': 'لا', 'please': 'من فضلك',
          'sorry': 'آسف', 'help': 'مساعدة', 'love': 'حب', 'water': 'ماء', 'friend': 'صديق', 'peace': 'سلام' },
    es: { 'hi': 'hola', 'hello': 'hola', 'good': 'bueno', 'how are you': 'cómo estás', 'thank you': 'gracias',
          'thanks': 'gracias', 'computer vision': 'visión por computadora', 'yes': 'sí', 'no': 'no', 'please': 'por favor',
          'sorry': 'lo siento', 'help': 'ayuda', 'love': 'amor', 'water': 'agua', 'friend': 'amigo', 'peace': 'paz' },
  };
  const cache = new Map();
  let tseq = 0;

  // Greedy longest-phrase lookup. Returns { text, complete }.
  function dictTranslate(text, lang) {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const out = []; let complete = true;
    for (let i = 0; i < words.length;) {
      let hit = null, n = 0;
      for (n = Math.min(3, words.length - i); n >= 1; n--) {
        const k = words.slice(i, i + n).join(' ');
        if (DICT[lang][k]) { hit = DICT[lang][k]; break; }
      }
      if (hit) { out.push(hit); i += n; } else { out.push(words[i]); complete = false; i++; }
    }
    return { text: out.join(' '), complete };
  }

  async function translateTo(text, lang) {
    const key = lang + '|' + text.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const d = dictTranslate(text, lang);
    if (d.complete) { cache.set(key, d.text); return d.text; }
    try {
      const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text.toLowerCase()) + '&langpair=en|' + lang;
      const r = await fetch(url);
      const j = await r.json();
      const t = j && j.responseData && j.responseData.translatedText;
      if (j.responseStatus == 200 && t && !/MYMEMORY WARNING/i.test(t)) { cache.set(key, t); return t; }
    } catch (e) { /* offline or rate-limited: fall back to what the dictionary knows */ }
    // Offline or rate-limited: show only what the built-in dictionary could translate.
    return d.text.toLowerCase() === text.toLowerCase() ? '' : d.text;
  }

  async function runTranslate() {
    const en = session.fullEnglish();
    const mine = ++tseq;
    if (!en) { showTranslation('', '', ''); return; }
    el.outAr.textContent = '…'; el.outEs.textContent = '…';
    const [ar, es] = await Promise.all([translateTo(en, 'ar'), translateTo(en, 'es')]);
    if (mine === tseq) showTranslation(en, ar, es);
  }

  function showTranslation(en, ar, es) {
    const put = (node, v) => { node.textContent = v || '—'; node.classList.toggle('dim', !v); };
    put(el.outEn, en); put(el.outAr, ar); put(el.outEs, es);
  }

  // ---------------------------------------------------------------- rendering
  let lastKeysSig = '', lastGuide = '';
  function setText(node, v) { if (node.textContent !== v) node.textContent = v; }

  function render() {
    setText(el.chip, S.status);

    const glyph = S.current || '–';
    setText(el.glyph, glyph);
    el.glyph.classList.toggle('long', glyph.length > 2);
    setText(el.pct, S.current ? Math.round(S.confidence * 100) + '%' : '');

    const progress = S.mode === 'tutor' ? Math.min(S.correctFrames / CFG.CORRECT_FRAMES, 1) : S.holdProgress;
    el.ring.style.strokeDashoffset = String(RING * (1 - progress));
    el.reading.classList.toggle('good', S.mode === 'tutor' && S.tutorDone);

    // banner
    let msg = '', kind = '';
    if (!hadHand) { msg = 'Show your hand to the camera'; kind = 'warn'; }
    else if (S.mode === 'tutor' && S.tutorDone) { msg = 'Good job. Press Next letter'; kind = 'good'; }
    else if (S.distance === 'too_close') { msg = 'Move back a little'; kind = 'warn'; }
    else if (S.distance === 'too_far') { msg = 'Move your hand closer'; kind = 'warn'; }
    el.banner.hidden = !msg; setText(el.banner, msg);
    el.banner.className = 'banner' + (kind ? ' ' + kind : '');

    // sentence keys
    const sig = S.words.join('|') + '#' + S.currentWord.join('');
    if (sig !== lastKeysSig) {
      lastKeysSig = sig;
      el.keys.textContent = '';
      for (const w of S.words) { const k = document.createElement('span'); k.className = 'key word'; k.textContent = w; el.keys.appendChild(k); }
      for (const c of S.currentWord) { const k = document.createElement('span'); k.className = 'key draft'; k.textContent = c; el.keys.appendChild(k); }
      if (!S.words.length && !S.currentWord.length) {
        const e = document.createElement('span'); e.className = 'empty'; e.textContent = 'Signs you confirm show up here'; el.keys.appendChild(e);
      }
    }

    // tutor guide
    const tutor = S.mode === 'tutor';
    el.guide.hidden = !tutor; el.tutorCard.hidden = !tutor;
    if (tutor && lastGuide !== S.tutorTarget) {
      lastGuide = S.tutorTarget;
      el.guideImg.src = 'guides/' + S.tutorTarget + '.png';
      setText(el.guideLetter, S.tutorTarget);
      el.tutorPick.value = S.tutorTarget;
    }
  }

  // ---------------------------------------------------------------- vision
  function onResults(res) {
    if (!running) return;
    const w = el.view.width, h = el.view.height;
    ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(res.image, 0, 0, w, h);
    ctx.restore();

    const lms = res.multiHandLandmarks && res.multiHandLandmarks[0];
    if (!lms) {
      hadHand = false; session.noHand(); render(); return;
    }
    hadHand = true;

    // A hand of the other side is mirrored back so the model always sees a training-style hand.
    const side = res.multiHandedness && res.multiHandedness[0] && res.multiHandedness[0].label;
    const flipX = !!side && side !== TRAIN_HAND;

    const feats = new Float32Array(63);
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (let i = 0; i < 21; i++) {
      const p = lms[i];
      feats[i * 3] = flipX ? 1 - p.x : p.x; feats[i * 3 + 1] = p.y; feats[i * 3 + 2] = p.z;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const size = Math.max(maxX - minX, maxY - minY);
    const distance = size > 0.55 ? 'too_close' : size < 0.18 ? 'too_far' : 'ok';

    const input = { distance };
    if (S.mode === 'word') input.word = SignEngine.predict(models.word, feats);
    else input.letter = SignEngine.predict(models.letter, feats);
    const ev = session.update(input, performance.now());
    if (ev.translate) runTranslate();

    drawHand(lms, w, h, minX, maxX, minY, maxY);
    render();
  }

  function drawHand(lms, w, h, minX, maxX, minY, maxY) {
    ctx.lineWidth = Math.max(2, w / 400);
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo((1 - lms[a].x) * w, lms[a].y * h); ctx.lineTo((1 - lms[b].x) * w, lms[b].y * h);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffc53d';
    const r = Math.max(3, w / 260);
    for (const p of lms) { ctx.beginPath(); ctx.arc((1 - p.x) * w, p.y * h, r, 0, 6.2832); ctx.fill(); }
    const pad = 25 * (w / 1280);
    ctx.strokeStyle = S.mode === 'tutor' && S.tutorDone ? '#12b383' : '#ffc53d';
    ctx.lineWidth = Math.max(2, w / 420);
    ctx.beginPath();
    ctx.roundRect((1 - maxX) * w - pad, minY * h - pad, (maxX - minX) * w + 2 * pad, (maxY - minY) * h + 2 * pad, 14);
    ctx.stroke();
  }

  async function tick() {
    if (!running) return;
    if (!busy && el.cam.readyState >= 2) {
      busy = true;
      pctx.save();
      pctx.drawImage(el.cam, 0, 0, proc.width, proc.height); pctx.restore();
      try { await hands.send({ image: proc }); } catch (e) { console.error(e); }
      busy = false;
    }
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- start up
  function gateError(msg) {
    el.gateErr.hidden = false; el.gateErr.textContent = msg;
    el.start.disabled = false; el.start.textContent = 'Try again';
    el.loadNote.hidden = false;
  }

  async function loadModels() {
    const [letter, word] = await Promise.all([
      fetch('models/letter.json').then((r) => { if (!r.ok) throw new Error('letter model'); return r.json(); }),
      fetch('models/word.json').then((r) => { if (!r.ok) throw new Error('word model'); return r.json(); }),
    ]);
    models = { letter, word };
    el.wordList.textContent = '';
    for (const w of word.labels) { const s = document.createElement('span'); s.textContent = w; el.wordList.appendChild(s); el.wordList.appendChild(document.createTextNode(' ')); }
  }

  async function start() {
    el.gateErr.hidden = true;
    el.start.disabled = true; el.start.textContent = 'Starting…';
    el.loadNote.textContent = 'Loading the models. This takes a few seconds the first time.';

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || (!window.isSecureContext && location.hostname !== 'localhost')) {
      return gateError('This page needs a secure (https) address to use the camera. Open the https link you were sent.');
    }
    if (typeof Hands === 'undefined') {
      return gateError('The hand tracker could not load. Check your internet connection and try again.');
    }
    try {
      if (!models) await loadModels();
    } catch (e) {
      return gateError('The sign models could not load. Refresh the page and try again.');
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      return gateError(denied
        ? 'Camera access was blocked. Allow the camera for this site in your browser, then try again.'
        : 'No camera was found. Connect one or open this page on a phone or laptop with a camera.');
    }

    try {
      el.cam.srcObject = stream; await el.cam.play();
      const vw = el.cam.videoWidth || 1280, vh = el.cam.videoHeight || 720;
      el.view.width = proc.width = vw; el.view.height = proc.height = vh;
      el.stage.style.aspectRatio = vw + ' / ' + vh;

      if (!hands) {
        hands = new Hands({ locateFile: (f) => 'mediapipe/' + f });
        hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        hands.onResults(onResults);
        await hands.initialize();
      }
    } catch (e) {
      console.error(e);
      stream.getTracks().forEach((t) => t.stop());
      return gateError('The hand tracker could not start. Check your internet connection and try again.');
    }

    el.gate.hidden = true; running = true; render(); showTranslation('', '', '');
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- controls
  function setMode(m) {
    session.setMode(m);
    el.tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
    $('bSpace').hidden = m !== 'letter';
    render();
  }
  function applyEvent(ev) { if (ev && ev.translate) runTranslate(); lastKeysSig = ''; render(); }

  el.start.addEventListener('click', start);
  el.tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
  $('bSpace').addEventListener('click', () => applyEvent(session.addSpace()));
  $('bDel').addEventListener('click', () => applyEvent(session.backspace()));
  $('bClear').addEventListener('click', () => { session.clear(); tseq++; showTranslation('', '', ''); lastKeysSig = ''; render(); });
  $('bTranslate').addEventListener('click', runTranslate);
  $('bNext').addEventListener('click', () => { session.nextTutor(); render(); });
  el.tutorPick.addEventListener('change', () => { session.setTutor(el.tutorPick.value); render(); });
  for (const c of SignLogic.TUTOR_LETTERS) { const o = document.createElement('option'); o.value = o.textContent = c; el.tutorPick.appendChild(o); }

  document.addEventListener('keydown', (e) => {
    if (el.gate.hidden === false || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName || '';
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || (tag === 'BUTTON' && e.key === 'Enter')) return;
    const k = e.key.toLowerCase();
    if (k === '1') setMode('letter'); else if (k === '2') setMode('word'); else if (k === '3') setMode('tutor');
    else if (k === 'n' && S.mode === 'tutor') { session.nextTutor(); render(); }
    else if (k === 'enter') runTranslate();
    else if (k === 'backspace') applyEvent(session.backspace());
    else if (k === 'c') { session.clear(); tseq++; showTranslation('', '', ''); lastKeysSig = ''; render(); }
  });

  window.addEventListener('pagehide', () => {
    const s = el.cam.srcObject; if (s) s.getTracks().forEach((t) => t.stop());
  });

  render();
})();
