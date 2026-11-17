/**
 * Ringtones, synthesised with Web Audio (original melodies; nothing to download).
 * Browsers only allow sound after the person has tapped the page at least once,
 * so the very first ring after opening the app may be silent (vibration still works).
 */

export type RingtoneId = 'marimba' | 'chimes' | 'harp' | 'classic';

export const RINGTONES: Array<{ id: RingtoneId; name: string }> = [
  { id: 'marimba', name: 'Marimba' },
  { id: 'chimes', name: 'Morning chimes' },
  { id: 'harp', name: 'Harp' },
  { id: 'classic', name: 'Classic phone' },
];

const KEY = 'familycall:ringtone';

export function getRingtone(): RingtoneId {
  try {
    const saved = localStorage.getItem(KEY) as RingtoneId | null;
    if (saved && RINGTONES.some((r) => r.id === saved)) return saved;
  } catch {
    // ignore
  }
  return 'marimba';
}

export function setRingtone(id: RingtoneId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Instruments

type Voice = 'marimba' | 'bell' | 'harp' | 'phone';

/** MIDI note number → frequency (A4 = 69 = 440 Hz). */
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function partial(ctx: AudioContext, out: AudioNode, type: OscillatorType, freq: number, t: number, peak: number, decay: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + decay + 0.05);
}

function strike(ctx: AudioContext, out: AudioNode, voice: Voice, freq: number, t: number, length = 0.25) {
  switch (voice) {
    case 'marimba': // warm wooden tone: fundamental + 4th harmonic that dies quickly
      partial(ctx, out, 'sine', freq, t, 0.9, 0.55);
      partial(ctx, out, 'sine', freq * 4, t, 0.22, 0.09);
      partial(ctx, out, 'sine', freq * 10, t, 0.05, 0.03);
      break;
    case 'bell': // inharmonic partials ring like a small bell
      partial(ctx, out, 'sine', freq, t, 0.7, 2.2);
      partial(ctx, out, 'sine', freq * 2.0, t, 0.3, 1.5);
      partial(ctx, out, 'sine', freq * 2.76, t, 0.22, 1.1);
      partial(ctx, out, 'sine', freq * 5.4, t, 0.08, 0.5);
      break;
    case 'harp': // plucked string
      partial(ctx, out, 'triangle', freq, t, 0.7, 1.2);
      partial(ctx, out, 'sine', freq * 2, t, 0.2, 0.6);
      break;
    case 'phone': { // the traditional 440 + 480 Hz ring
      for (const f of [440, 480]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.5, t + 0.03);
        gain.gain.setValueAtTime(0.5, t + length - 0.05);
        gain.gain.linearRampToValueAtTime(0, t + length);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + length + 0.05);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Melodies: [time in seconds, MIDI note] within one loop.

interface Pattern {
  voice: Voice;
  loop: number; // seconds per repeat
  notes: Array<[number, number]>;
  noteLength?: number;
  volume: number;
  vibrate?: number[];
}

const step = 0.14;
const PATTERNS: Record<RingtoneId | 'ringback', Pattern> = {
  // Bright arpeggio in C, answered in G.
  marimba: {
    voice: 'marimba',
    loop: 2.9,
    volume: 0.32,
    notes: [
      [0, 76], [step, 79], [step * 2, 84], [step * 3, 79], [step * 4, 76], [step * 5, 79], [step * 6, 84], [step * 7, 88],
      [1.35, 74], [1.35 + step, 79], [1.35 + step * 2, 83], [1.35 + step * 3, 79], [1.35 + step * 4, 74], [1.35 + step * 5, 79], [1.35 + step * 6, 83], [1.35 + step * 7, 86],
    ],
    vibrate: [500, 250, 500],
  },
  // Two gentle phrases on bells.
  chimes: {
    voice: 'bell',
    loop: 4,
    volume: 0.22,
    notes: [[0, 84], [0.45, 81], [0.9, 77], [1.35, 72], [2.1, 74], [2.4, 77], [2.7, 81], [3.0, 84]],
    vibrate: [400, 300, 400],
  },
  // A rising sweep that settles.
  harp: {
    voice: 'harp',
    loop: 2.6,
    volume: 0.38,
    notes: [[0, 60], [0.09, 64], [0.18, 67], [0.27, 72], [0.36, 76], [0.45, 79], [0.54, 84], [0.9, 79], [1.05, 84]],
    vibrate: [300, 200, 300],
  },
  classic: {
    voice: 'phone',
    loop: 4,
    volume: 0.18,
    notes: [[0, 0]],
    noteLength: 1.6,
    vibrate: [800, 200, 800],
  },
  // What the caller hears while it rings at the other end.
  ringback: {
    voice: 'phone',
    loop: 4,
    volume: 0.06,
    notes: [[0, 0]],
    noteLength: 1,
  },
};

function play(pattern: Pattern, loops = Infinity): () => void {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  try {
    ctx = new AudioContext();
    void ctx.resume();
    master = ctx.createGain();
    master.gain.value = pattern.volume;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let count = 0;

  const scheduleLoop = () => {
    if (stopped || count >= loops) return;
    count++;
    if (ctx && master) {
      const start = ctx.currentTime + 0.05;
      for (const [t, midi] of pattern.notes) strike(ctx, master, pattern.voice, hz(midi), start + t, pattern.noteLength);
    }
    if (pattern.vibrate) navigator.vibrate?.(pattern.vibrate);
    timer = setTimeout(scheduleLoop, pattern.loop * 1000);
  };
  scheduleLoop();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (pattern.vibrate) navigator.vibrate?.(0);
    void ctx?.close();
  };
}

/** Incoming call ring (with vibration), using the chosen ringtone. Returns a function that stops it. */
export const playRingtone = (id: RingtoneId = getRingtone()) => play(PATTERNS[id]);
/** Plays one round of a ringtone, for choosing in settings. */
export const previewRingtone = (id: RingtoneId) => play({ ...PATTERNS[id], vibrate: undefined }, 1);
/** The "ring ring" the caller hears while waiting. Returns a function that stops it. */
export const playRingback = () => play(PATTERNS.ringback);
