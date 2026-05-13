let ctx = null;

function ensure() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function envelope(node, startT, attack, decay, peak = 0.4) {
  const c = ensure();
  const g = c.createGain();
  g.gain.setValueAtTime(0, startT);
  g.gain.linearRampToValueAtTime(peak, startT + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, startT + attack + decay);
  node.connect(g);
  g.connect(c.destination);
  return g;
}

export const SFX = {
  jump() {
    const c = ensure();
    const o = c.createOscillator();
    o.type = 'square';
    const t = c.currentTime;
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.1);
    envelope(o, t, 0.005, 0.12, 0.15);
    o.start(t); o.stop(t + 0.15);
  },
  step() {
    const c = ensure();
    const buf = c.createBuffer(1, 1000, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 350;
    const g = c.createGain();
    g.gain.value = 0.18;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start();
  },
  land() {
    const c = ensure();
    const buf = c.createBuffer(1, 2000, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.8;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 250;
    const g = c.createGain();
    g.gain.value = 0.35;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start();
  },
  kill() {
    const c = ensure();
    const t = c.currentTime;
    for (const freq of [180, 240, 360]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.4);
      envelope(o, t, 0.01, 0.4, 0.18);
      o.start(t); o.stop(t + 0.5);
    }
  },
  reveal() {
    const c = ensure();
    const t = c.currentTime;
    [523, 659, 784].forEach((f, i) => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      envelope(o, t + i * 0.06, 0.005, 0.22, 0.3);
      o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.3);
    });
  },
  die() {
    const c = ensure();
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.9);
    envelope(o, t, 0.01, 0.9, 0.35);
    o.start(t); o.stop(t + 1.0);
  },
  start() {
    const c = ensure();
    const t = c.currentTime;
    [392, 523, 659, 784].forEach((f, i) => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      envelope(o, t + i * 0.08, 0.005, 0.22, 0.35);
      o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.25);
    });
  },
  hover() {
    const c = ensure();
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 880;
    envelope(o, t, 0.001, 0.05, 0.08);
    o.start(t); o.stop(t + 0.08);
  },
};
