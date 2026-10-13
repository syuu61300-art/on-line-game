// All sounds are synthesised with WebAudio at runtime.
export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.mix = { sfx: 1, amb: 0.6, ui: 0.8 };
    this.ready = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.mix.sfx; this.sfx.connect(this.master);
    this.ui = ctx.createGain(); this.ui.gain.value = 0.7 * this.mix.ui; this.ui.connect(this.master);
    // shared noise buffers
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.ready = true;
    this._ambient();
    if (ctx.state === 'suspended') ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // master / effects (guns, steps, explosions together) / ambience / notifications
  setMix(master, sfx, amb, ui) {
    this.volume = master;
    this.mix = { sfx, amb, ui };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.05);
    this.sfx.gain.setTargetAtTime(sfx, t, 0.05);
    this.ui.gain.setTargetAtTime(0.7 * ui, t, 0.05);
    if (this.ambientGain) this.ambientGain.gain.setTargetAtTime(0.18 * amb, t, 0.05);
  }

  updateListener(pos, fwd) {
    if (!this.ready) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
    this._lp = pos;
  }

  // output chain: local (dry) or spatial with distance muffling
  _out(pos, gain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (!pos) { g.connect(this.sfx); return g; }
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 4; p.maxDistance = 400; p.rolloffFactor = 1.05;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const lpos = this._lp || { x: 0, y: 0, z: 0 };
    const dist = Math.hypot(pos.x - lpos.x, pos.y - lpos.y, pos.z - lpos.z);
    lp.frequency.value = 600 + 17000 * Math.exp(-dist / 45);
    g.connect(lp).connect(p).connect(this.sfx);
    return g;
  }

  _noise(out, t, dur, type, freq, q, g0, decay, rate = 1, buf) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf || this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(g0, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * Math.max(0, 1.9 - dur), dur + 0.05);
    return f;
  }

  _tone(out, t, type, f0, f1, g0, decay, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + (dur || decay));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(g0, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + decay + 0.05);
  }

  gun(def, pos = null, vol = 1) {
    if (!this.ready || !def.sound) return;
    const s = def.sound, t = this.ctx.currentTime;
    const out = this._out(pos, s.gain * vol);
    this._noise(out, t, 0.12, 'bandpass', s.crack * (0.92 + Math.random() * 0.16), 0.7, 0.9, 0.09);
    this._noise(out, t, 0.05, 'highpass', 3500, 0.5, 0.35, 0.03);
    this._tone(out, t, 'sine', s.body * 2.2, s.body * 0.7, 0.9, 0.16, 0.1);
    this._tone(out, t, 'triangle', s.body * 3, s.body, 0.3, 0.07);
    this._noise(out, t + 0.01, s.tail, 'lowpass', 900, 0.3, 0.32, s.tail, 0.6, this.brown);
    if (!pos) this._noise(out, t + 0.03, s.tail * 1.2, 'bandpass', 420, 0.6, 0.12, s.tail * 1.3); // slap-back
  }

  click(freq = 2400, gain = 0.25, when = 0, pos = null) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const out = this._out(pos, 1);
    this._noise(out, t, 0.02, 'bandpass', freq, 6, gain, 0.025);
    this._tone(out, t, 'square', freq * 0.5, freq * 0.45, gain * 0.15, 0.02);
  }

  reload(def, dur) {
    if (!this.ready) return;
    if (def.shellReload) return;
    this.click(1800, 0.3, dur * 0.18);  // mag out
    this.click(900, 0.2, dur * 0.22);
    this.click(2200, 0.35, dur * 0.55); // mag in
    this.click(1300, 0.3, dur * 0.58);
    this.click(3000, 0.35, dur * 0.82); // charge
    this.click(1600, 0.3, dur * 0.86);
  }
  shell() { this.click(2000, 0.25, 0); this.click(1100, 0.2, 0.06); }
  pump(when = 0.12) { this.click(1500, 0.35, when); this.click(900, 0.3, when + 0.1); }
  bolt(when = 0.15) { this.click(2600, 0.3, when); this.click(1700, 0.28, when + 0.18); this.click(2900, 0.3, when + 0.42); }
  empty() { this.click(3200, 0.25, 0); }
  swap() { this.click(1200, 0.2, 0); this.click(2600, 0.18, 0.08); }

  swing() {
    if (!this.ready) return;
    const t = this.ctx.currentTime, out = this._out(null, 0.5);
    const f = this._noise(out, t, 0.2, 'bandpass', 600, 1.2, 0.6, 0.18);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.15);
  }

  step(pos, metal, gain = 0.35) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, gain);
    this._noise(out, t, 0.08, 'lowpass', 500 + Math.random() * 400, 1, 0.8, 0.07);
    if (metal) this._noise(out, t, 0.12, 'bandpass', 1800 + Math.random() * 600, 8, 0.25, 0.12);
    else this._noise(out, t + 0.012, 0.04, 'highpass', 4000, 0.5, 0.12, 0.03);
  }
  land(metal) { if (!this.ready) return; const t = this.ctx.currentTime, out = this._out(null, 0.6); this._noise(out, t, 0.15, 'lowpass', 300, 1, 0.9, 0.14); if (metal) this._noise(out, t, 0.25, 'bandpass', 1300, 10, 0.25, 0.25); }
  jump() { if (!this.ready) return; const t = this.ctx.currentTime, out = this._out(null, 0.3); this._noise(out, t, 0.08, 'lowpass', 700, 1, 0.5, 0.08); }

  hit(head, kill) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (head) {
      this._tone(this.ui, t, 'sine', 2600, 2600, 0.35, 0.22);
      this._tone(this.ui, t, 'sine', 3900, 3900, 0.18, 0.18);
    } else {
      this._noise(this.ui, t, 0.03, 'bandpass', 3000, 4, 0.5, 0.03);
      this._tone(this.ui, t, 'square', 1700, 1500, 0.06, 0.03);
    }
    if (kill) {
      this._tone(this.ui, t + 0.05, 'triangle', 620, 620, 0.3, 0.18);
      this._tone(this.ui, t + 0.13, 'triangle', 930, 930, 0.28, 0.3);
    }
  }

  hurt() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone(this.ui, t, 'sine', 160, 60, 0.6, 0.18);
    this._noise(this.ui, t, 0.1, 'lowpass', 400, 1, 0.5, 0.1);
  }

  explosion(pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 1.6);
    const f = this._noise(out, t, 1.8, 'lowpass', 2600, 0.7, 1.0, 1.6, 0.7, this.brown);
    f.frequency.exponentialRampToValueAtTime(140, t + 1.2);
    this._noise(out, t, 0.3, 'bandpass', 900, 0.6, 0.8, 0.25);
    this._tone(out, t, 'sine', 90, 30, 1.0, 0.9, 0.6);
  }

  bounce(pos) { if (!this.ready) return; const t = this.ctx.currentTime; const out = this._out(pos, 0.5); this._tone(out, t, 'triangle', 1900, 1600, 0.2, 0.08); this._noise(out, t, 0.04, 'bandpass', 2600, 8, 0.2, 0.05); }
  pin() { this.click(3400, 0.25, 0); this.click(2100, 0.2, 0.09); }
  pickup() { if (!this.ready) return; const t = this.ctx.currentTime; this._tone(this.ui, t, 'triangle', 880, 880, 0.25, 0.12); this._tone(this.ui, t + 0.08, 'triangle', 1320, 1320, 0.25, 0.2); }
  spawn() { if (!this.ready) return; const t = this.ctx.currentTime; this._tone(this.ui, t, 'sine', 440, 660, 0.15, 0.35, 0.3); }
  chat() { if (!this.ready) return; const t = this.ctx.currentTime; this._tone(this.ui, t, 'sine', 1200, 1200, 0.12, 0.08); }
  horn() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const out = this.ctx.createGain(); out.gain.value = 0.22; out.connect(this.master);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.connect(out);
    for (const f of [73, 110, 146.5]) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.6);
      g.gain.setValueAtTime(0.25, t + 2.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
      o.connect(g).connect(lp); o.start(t); o.stop(t + 3.5);
    }
  }
  roundEnd() { if (!this.ready) return; const t = this.ctx.currentTime; [523, 659, 784, 1046].forEach((f, i) => this._tone(this.ui, t + i * 0.12, 'triangle', f, f, 0.25, 0.4)); }

  _ambient() {
    const ctx = this.ctx;
    const amb = ctx.createGain(); amb.gain.value = 0.18 * this.mix.amb; amb.connect(this.master);
    // wind
    const w = ctx.createBufferSource(); w.buffer = this.brown; w.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 420;
    const wg = ctx.createGain(); wg.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.3;
    lfo.connect(lfoG).connect(wg.gain);
    w.connect(wf).connect(wg).connect(amb);
    w.start(); lfo.start();
    // water lapping
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 380; sf.Q.value = 0.8;
    const sg = ctx.createGain(); sg.gain.value = 0.1;
    const l2 = ctx.createOscillator(); l2.frequency.value = 0.23;
    const l2g = ctx.createGain(); l2g.gain.value = 0.08;
    l2.connect(l2g).connect(sg.gain);
    s.connect(sf).connect(sg).connect(amb);
    s.start(); l2.start();
    this.ambientGain = amb;
  }
}
