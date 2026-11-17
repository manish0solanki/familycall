/**
 * Phone-style tones made with Web Audio (no sound files to download).
 * Browsers may block sound until the person has tapped the page once.
 */
type Pattern = { onMs: number; offMs: number; freqs: number[]; volume: number; vibrate?: boolean };

const RINGTONE: Pattern = { onMs: 1600, offMs: 2400, freqs: [440, 480], volume: 0.18, vibrate: true };
const RINGBACK: Pattern = { onMs: 1000, offMs: 3000, freqs: [440, 480], volume: 0.06 };

function play(pattern: Pattern): () => void {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    void ctx.resume();
  } catch {
    ctx = null;
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const burst = () => {
    if (stopped) return;
    if (ctx) {
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(pattern.volume, t + 0.03);
      gain.gain.setValueAtTime(pattern.volume, t + pattern.onMs / 1000 - 0.05);
      gain.gain.linearRampToValueAtTime(0, t + pattern.onMs / 1000);
      gain.connect(ctx.destination);
      for (const f of pattern.freqs) {
        const osc = ctx.createOscillator();
        osc.frequency.value = f;
        osc.connect(gain);
        osc.start(t);
        osc.stop(t + pattern.onMs / 1000);
      }
    }
    if (pattern.vibrate) navigator.vibrate?.([pattern.onMs / 2, 200, pattern.onMs / 2]);
    timer = setTimeout(burst, pattern.onMs + pattern.offMs);
  };
  burst();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (pattern.vibrate) navigator.vibrate?.(0);
    void ctx?.close();
  };
}

/** Incoming call ring (with vibration). Returns a function that stops it. */
export const playRingtone = () => play(RINGTONE);
/** The "ring ring" the caller hears while waiting. Returns a function that stops it. */
export const playRingback = () => play(RINGBACK);
