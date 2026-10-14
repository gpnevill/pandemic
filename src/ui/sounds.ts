// Tiny synthesized sound effects — no audio files, just short Web Audio blips.
// Everything is quiet and < 300ms; a master mute is persisted to localStorage.

let ctx: AudioContext | null = null;
let muted = localStorage.getItem('pandemic-muted') === '1';

export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem('pandemic-muted', m ? '1' : '0');
}

export function isMuted() {
  return muted;
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  delay?: number;
  slide?: number; // glide to this frequency over the duration
}

function tone(freq: number, dur: number, opts: ToneOpts = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
  const v = opts.vol ?? 0.06;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(v, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, opts: { vol?: number; freq?: number; q?: number; delay?: number } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = opts.freq ?? 3000;
  f.Q.value = opts.q ?? 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.vol ?? 0.045, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur);
}

export const S = {
  /** generic soft UI tick (phase changes, begin turn) */
  click: () => tone(880, 0.045, { type: 'triangle', vol: 0.04 }),
  /** pawn movement — a lower wooden tock */
  move: () => tone(340, 0.07, { type: 'triangle', vol: 0.07, slide: 250 }),
  /** card dealt / handed over — a short swish */
  deal: () => noise(0.09, { freq: 4200, vol: 0.055 }),
  /** disease cube placed — a soft plip */
  cube: () => tone(520, 0.06, { vol: 0.055, slide: 380 }),
  /** cubes treated / removed — a rising plip */
  treat: () => tone(390, 0.07, { vol: 0.055, slide: 560 }),
  /** outbreak — a muffled thud */
  outbreak: () => {
    tone(130, 0.22, { type: 'sawtooth', vol: 0.08, slide: 70 });
    noise(0.14, { freq: 380, vol: 0.045, q: 1.2 });
  },
  /** epidemic revealed — two low warning notes */
  epidemic: () => {
    tone(220, 0.16, { type: 'square', vol: 0.045 });
    tone(165, 0.24, { type: 'square', vol: 0.045, delay: 0.15 });
  },
  /** infection rate rises — a quick upward chirp */
  rate: () => tone(650, 0.09, { type: 'square', vol: 0.035, slide: 950 }),
  /** cure discovered — a little arpeggio */
  cure: () => [523, 659, 784].forEach((f, i) => tone(f, 0.14, { vol: 0.055, delay: i * 0.09 })),
  /** defeat — a slow falling tone */
  defeat: () => tone(196, 0.5, { vol: 0.06, slide: 92 }),
};

/* ------------------------------------------------ victory music (regal!) */

/** Two slightly detuned sawtooths through a lowpass — a passable brass section. */
function brass(freq: number, dur: number, delay: number, vol = 0.07) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  for (const cents of [0, 5]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * Math.pow(2, cents / 1200), t0);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 3.5, t0);
    const g = c.createGain();
    const v = vol / 2;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(v, t0 + 0.045);
    g.gain.setValueAtTime(v, t0 + Math.max(0.05, dur - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(f).connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

/** Timpani: a falling sine thump with a touch of skin noise. */
function timpani(delay: number, vol = 0.1, freq = 98) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t0 + 0.4);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.55);
  noise(0.05, { freq: 220, vol: vol * 0.4, q: 0.7, delay });
}

/** Sustained string-section pad: slow attack, gentle release. */
function strings(freq: number, dur: number, delay: number, vol = 0.02) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  for (const cents of [-6, 6]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * Math.pow(2, cents / 1200), t0);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 2.2, t0);
    const g = c.createGain();
    const v = vol / 2;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(v, t0 + 0.35);
    g.gain.setValueAtTime(v, t0 + Math.max(0.4, dur - 0.5));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(f).connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

const N = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, C6: 1046.5,
};

type Notes = Array<[number, number, number]>; // [time, freq, dur]

const playBrass = (notes: Notes, vol: number, base = 0) =>
  notes.forEach(([t, f, d]) => brass(f, d, base + t, vol));

/** Introductory (~6s loop): bright fanfare over a string pad. */
function victoryTier1(): number {
  strings(N.C4, 5.2, 0);
  strings(N.E4, 5.2, 0, 0.016);
  strings(N.G4, 5.2, 0, 0.016);
  playBrass(
    [
      [0.0, N.G4, 0.14], [0.18, N.G4, 0.14], [0.36, N.G4, 0.14],
      [0.54, N.C5, 0.7], [1.3, N.E5, 0.4], [1.75, N.G5, 0.9],
    ],
    0.08
  );
  brass(N.C3, 0.7, 0.54, 0.06);
  timpani(0.0);
  timpani(0.54);
  [N.C4, N.E4, N.G4, N.C5, N.E5].forEach((f) => brass(f, 2.2, 3.0, 0.05));
  brass(N.C3, 2.2, 3.0, 0.06);
  timpani(3.0, 0.13);
  timpani(3.6, 0.07);
  return 6.0;
}

/** Standard (~10s loop): full progression — C, Am, F, G — with bass and harmony. */
function victoryTier2(): number {
  // string pads follow the harmony
  const pads: Array<[number, number, number[]]> = [
    [0.0, 2.4, [N.C4, N.E4, N.G4]],
    [2.4, 2.0, [N.A3, N.C4, N.E4]],
    [4.4, 2.0, [N.F3, N.A3, N.C4]],
    [6.4, 1.4, [N.G3, N.B3, N.D4]],
    [7.8, 2.6, [N.C4, N.E4, N.G4]],
  ];
  pads.forEach(([t, d, fs]) => fs.forEach((f) => strings(f, d, t, 0.018)));
  // bass roots
  ([[0.0, N.C3, 2.3], [2.4, N.A3, 1.9], [4.4, N.F3, 1.9], [6.4, N.G3, 1.3], [7.8, N.C3, 2.4]] as Notes).forEach(
    ([t, f, d]) => brass(f, d, t, 0.055)
  );
  // melody
  playBrass(
    [
      [0.0, N.G4, 0.14], [0.18, N.G4, 0.14], [0.36, N.G4, 0.14],
      [0.54, N.C5, 0.7], [1.3, N.E5, 0.5],
      [2.4, N.E5, 0.3], [2.75, N.D5, 0.3], [3.1, N.C5, 0.5], [3.7, N.A4, 0.5],
      [4.4, N.F5, 0.3], [4.75, N.E5, 0.3], [5.1, N.D5, 0.5], [5.7, N.C5, 0.5],
      [6.4, N.D5, 0.3], [6.75, N.E5, 0.3], [7.1, N.F5, 0.55],
      [7.8, N.G5, 1.4],
    ],
    0.08
  );
  // harmony thirds on the held notes
  playBrass(
    [
      [0.54, N.E4, 0.7], [1.3, N.G4, 0.5], [7.8, N.E5, 1.4],
    ],
    0.04
  );
  timpani(0.0);
  timpani(2.4, 0.09);
  timpani(4.4, 0.09);
  timpani(6.4, 0.1);
  timpani(7.8, 0.13);
  [N.C4, N.E4, N.G4, N.C5].forEach((f) => brass(f, 1.9, 7.8, 0.045));
  noise(1.4, { freq: 8000, vol: 0.014, delay: 7.8 });
  return 10.2;
}

/** Heroic (~14s loop): timpani roll, three phrases, suspension, and a colossal finish. */
function victoryTier3(): number {
  for (let i = 0; i < 10; i++) timpani(i * 0.08, 0.04 + i * 0.01);
  noise(0.7, { freq: 6000, vol: 0.016, delay: 0.5 });
  const b = 0.9;
  // harmonic bed: C, F, C, Am, G, Csus4→C
  const pads: Array<[number, number, number[]]> = [
    [0.0, 2.4, [N.C4, N.E4, N.G4]],
    [2.4, 1.6, [N.F3, N.A3, N.C4]],
    [4.0, 2.2, [N.C4, N.E4, N.G4]],
    [6.2, 1.6, [N.A3, N.C4, N.E4]],
    [7.8, 1.4, [N.G3, N.B3, N.D4]],
    [9.2, 1.1, [N.C4, N.F4, N.G4]],
    [10.3, 3.2, [N.C4, N.E4, N.G4, N.C5]],
  ];
  pads.forEach(([t, d, fs]) => fs.forEach((f) => strings(f, d, b + t, 0.02)));
  // bass line
  (
    [
      [0.0, N.C3, 2.3], [2.4, N.F3, 1.5], [4.0, N.C3, 2.1],
      [6.2, N.A3, 1.5], [7.8, N.G3, 1.3], [9.2, N.C3, 1.0], [10.3, N.C3, 3.0],
    ] as Notes
  ).forEach(([t, f, d]) => brass(f, d, b + t, 0.06));
  // phrase A: the call
  playBrass(
    [
      [0.0, N.G4, 0.14], [0.18, N.G4, 0.14], [0.36, N.G4, 0.14],
      [0.54, N.C5, 0.7], [1.3, N.E5, 0.5], [1.85, N.G5, 0.5],
    ],
    0.085,
    b
  );
  // phrase B: soaring answer
  playBrass(
    [
      [2.4, N.A5, 0.45], [2.9, N.G5, 0.35], [3.3, N.F5, 0.3], [3.65, N.E5, 0.3],
      [4.0, N.G5, 0.9], [5.0, N.E5, 0.5], [5.55, N.C5, 0.5],
    ],
    0.085,
    b
  );
  // phrase C: lyrical descent and rise
  playBrass(
    [
      [6.2, N.E5, 0.35], [6.6, N.D5, 0.35], [7.0, N.C5, 0.6],
      [7.8, N.D5, 0.35], [8.2, N.E5, 0.35], [8.6, N.F5, 0.5],
    ],
    0.08,
    b
  );
  // suspension... and the triumph
  playBrass([[9.2, N.F5, 1.0]], 0.075, b);
  [N.C4, N.E4, N.G4, N.C5, N.E5, N.G5, N.C6].forEach((f) => brass(f, 3.0, b + 10.3, 0.048));
  timpani(b + 0.54);
  timpani(b + 2.4, 0.1);
  timpani(b + 4.0, 0.1);
  timpani(b + 6.2, 0.09);
  timpani(b + 7.8, 0.1);
  timpani(b + 10.3, 0.14);
  timpani(b + 10.9, 0.09);
  timpani(b + 11.5, 0.06);
  noise(2.4, { freq: 8000, vol: 0.02, delay: b + 10.3 });
  return 14.6;
}

let victoryTimer: number | null = null;

/** Start the looping victory fanfare — regalness scales with the difficulty conquered. */
export function startVictoryMusic(epidemics: number) {
  stopVictoryMusic();
  const play = () => {
    const dur = epidemics >= 6 ? victoryTier3() : epidemics === 5 ? victoryTier2() : victoryTier1();
    victoryTimer = window.setTimeout(play, (dur + 0.5) * 1000);
  };
  play();
}

export function stopVictoryMusic() {
  if (victoryTimer !== null) {
    clearTimeout(victoryTimer);
    victoryTimer = null;
  }
}
