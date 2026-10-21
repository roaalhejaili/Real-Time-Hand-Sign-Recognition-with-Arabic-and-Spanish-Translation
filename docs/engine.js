// Tiny MLP inference engine (Dense + ReLU/Softmax + BatchNorm) for the exported Keras models.
(function (root) {
  function run(model, input) {
    let x = Float32Array.from(input);
    for (const L of model.layers) {
      if (L.t === 'dense') {
        const y = new Float32Array(L.o);
        for (let j = 0; j < L.o; j++) y[j] = L.b[j];
        for (let i = 0; i < L.i; i++) {
          const xi = x[i];
          if (xi === 0) continue;
          const row = i * L.o;
          for (let j = 0; j < L.o; j++) y[j] += xi * L.W[row + j];
        }
        if (L.act === 'relu') {
          for (let j = 0; j < L.o; j++) if (y[j] < 0) y[j] = 0;
        } else if (L.act === 'softmax') {
          let m = -Infinity;
          for (let j = 0; j < L.o; j++) if (y[j] > m) m = y[j];
          let s = 0;
          for (let j = 0; j < L.o; j++) { y[j] = Math.exp(y[j] - m); s += y[j]; }
          for (let j = 0; j < L.o; j++) y[j] /= s;
        }
        x = y;
      } else if (L.t === 'bn') {
        for (let i = 0; i < x.length; i++) x[i] = x[i] * L.scale[i] + L.shift[i];
      }
    }
    return x;
  }
  function predict(model, input) {
    const p = run(model, input);
    let k = 0;
    for (let i = 1; i < p.length; i++) if (p[i] > p[k]) k = i;
    return { label: model.labels[k], index: k, confidence: p[k], probs: p };
  }
  const api = { run, predict };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SignEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
