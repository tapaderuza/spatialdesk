/**
 * Interface sounds, synthesised with Web Audio (no files, no licences): a soft tick on every tap, distinct short
 * shapes for picking up, dropping, applying a plan, undoing, an error and a nudge. Quiet by design and switchable
 * off in the settings (the timer alarm stays: it is information, not decoration).
 */
import { settings } from './settings.js';

let context: AudioContext | null = null;

/** Browsers start audio only after a gesture: called on every tap. */
export function unlockAudio(): void {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
  } catch {
    context = null; // no Web Audio: everything still shows visually
  }
}

export function audioContext(): AudioContext | null {
  return context;
}

export type Sound = 'tap' | 'pick' | 'drop' | 'apply' | 'undo' | 'error' | 'nudge' | 'listen' | 'grow';

/** [start Hz, end Hz, duration ms, waveform] notes, played in sequence. */
const SHAPES: Record<Sound, [number, number, number, OscillatorType][]> = {
  tap: [[1400, 1150, 35, 'triangle']],
  pick: [[600, 920, 80, 'sine']],
  drop: [[540, 340, 90, 'sine']],
  apply: [[660, 660, 110, 'sine'], [880, 880, 170, 'sine']],
  undo: [[720, 430, 140, 'sine']],
  error: [[220, 185, 160, 'triangle']],
  nudge: [[880, 880, 90, 'sine'], [1175, 1175, 120, 'sine']],
  listen: [[523, 784, 140, 'sine']],
  // The focus plant grows a leaf: three soft rising notes, higher and slower than any control's.
  grow: [[784, 784, 120, 'sine'], [988, 988, 120, 'sine'], [1319, 1319, 260, 'sine']],
};

export function play(sound: Sound, pan = 0): void {
  if (!settings.sound || !context || context.state !== 'running') return;
  const ctx = context;
  const out = ctx.createStereoPanner();
  out.pan.value = pan;
  out.connect(ctx.destination);
  let at = ctx.currentTime + 0.01;
  for (const [from, to, ms, type] of SHAPES[sound]) {
    const seconds = ms / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + seconds);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.09, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
    at += seconds * 0.85;
  }
}
