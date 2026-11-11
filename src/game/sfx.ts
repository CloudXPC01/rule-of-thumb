/**
 * Tiny procedural sound kit (WebAudio). No audio files: every sound is
 * synthesised, all notes sit in one pentatonic scale so play sounds musical.
 */

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const ROOT = 392; // G4

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlay: Record<string, number> = {};

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function throttle(key: string, ms: number): boolean {
  const now = performance.now();
  if ((lastPlay[key] ?? 0) + ms > now) return false;
  lastPlay[key] = now;
  return true;
}

function note(step: number): number {
  const s = SCALE[((step % SCALE.length) + SCALE.length) % SCALE.length];
  return ROOT * Math.pow(2, s / 12);
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, glide = 0) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, filterFreq: number, when = 0, q = 1) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + when;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = filterFreq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const Sfx = {
  unlock() {
    ac();
  },
  /** Raindrop plink on a random pentatonic note. */
  plink(seed: number) {
    if (!throttle('plink', 45)) return;
    tone(note(5 + (seed % 6)), 0.18, 'sine', 0.06);
  },
  pluck() {
    tone(note(3), 0.12, 'triangle', 0.15, 0, 1.5);
  },
  plant() {
    tone(note(2), 0.08, 'square', 0.05);
    tone(note(4), 0.18, 'triangle', 0.12, 0.05);
    noise(0.06, 0.15, 400);
  },
  chop() {
    if (!throttle('chop', 120)) return;
    noise(0.05, 0.25, 1800, 0, 4);
    tone(220, 0.05, 'square', 0.03);
  },
  fall() {
    noise(0.35, 0.18, 300, 0, 0.7);
    tone(140, 0.3, 'sine', 0.12, 0, 0.5);
  },
  gasp(seed: number) {
    if (!throttle('gasp', 150)) return;
    const f = 700 + (seed % 5) * 90;
    tone(f, 0.12, 'sine', 0.08, 0, 1.6);
    noise(0.08, 0.05, 3000);
  },
  gibber(seed: number) {
    if (!throttle('gib' + (seed % 3), 90)) return;
    for (let i = 0; i < 3; i++) tone(note((seed + i * 3) % 9) * 1.5, 0.06, 'square', 0.025, i * 0.07);
  },
  chisel() {
    if (!throttle('chisel', 55)) return;
    noise(0.03, 0.2, 4200, 0, 6);
  },
  commandment() {
    // choir-ish stab: stacked fifths with slow attack
    [0, 4, 7, 12].forEach((s, i) => tone(ROOT * Math.pow(2, s / 12) / 2, 1.6, 'sawtooth', 0.02, i * 0.03));
    [0, 7].forEach((s) => tone(ROOT * Math.pow(2, s / 12), 1.4, 'sine', 0.06));
  },
  bless() {
    [0, 2, 4, 7].forEach((s, i) => tone(note(s + 3), 0.4, 'sine', 0.07, i * 0.06));
  },
  crush() {
    noise(0.4, 0.4, 500, 0, 0.5);
    tone(90, 0.4, 'sawtooth', 0.08, 0, 0.5);
    tone(note(2) / 2, 0.5, 'sine', 0.05, 0.25, 0.7); // the "ooooh"
  },
  pop() {
    tone(note(4), 0.1, 'sine', 0.1, 0, 2);
  },
  hut() {
    [0, 2, 4].forEach((s, i) => tone(note(s), 0.12, 'triangle', 0.08, i * 0.07));
  },
  squish(curl: number) {
    if (!throttle('squish', 160)) return;
    tone(300 + curl * 300, 0.12, 'sine', 0.05, 0, 0.6);
  },
  thunder() {
    noise(1.4, 0.5, 120, 0.15, 0.5);
    noise(0.08, 0.4, 2500);
  },
  sizzle() {
    if (!throttle('sizzle', 200)) return;
    noise(0.4, 0.15, 5000, 0, 0.8);
  },
  fire() {
    if (!throttle('fire', 400)) return;
    noise(0.3, 0.05, 900, 0, 0.6);
  },
  splash() {
    noise(0.2, 0.2, 1200, 0, 1);
    tone(note(6), 0.12, 'sine', 0.06, 0.03);
  },
  fanfare() {
    [0, 2, 4, 5, 7, 9, 10].forEach((s, i) => tone(note(s), 0.35, 'triangle', 0.08, i * 0.12));
  },
  setMaster(v: number) {
    if (master) master.gain.value = v;
  },
};
