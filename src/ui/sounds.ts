/**
 * The sound of SpatialDesk, synthesised with Web Audio (no files, no licences). Every cue is the same soft mallet (a
 * sine with a quickly fading fourth partial, through a gentle low-pass), tuned to one pentatonic scale, so the cues
 * belong to one instrument and never clash when they overlap. They sound from where things happen: a tap from the
 * control, the alarm from the timer, the plant's notes from the plant (HRTF, placed relative to the head when they
 * play). During a focus block a quiet ambience of soft air, breathing slowly, fades in, and out again when the block
 * pauses or ends. Everything follows the Sound setting except the timer's alarm, which is information, not decoration.
 */
import { Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import { onSettings, settings } from './settings.js';

let context: AudioContext | null = null;
let master: GainNode | null = null;

/** Browsers start audio only after a gesture: called on every tap. */
export function unlockAudio(): void {
  try {
    if (!context) {
      context = new AudioContext();
      const soften = context.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 6500;
      master = context.createGain();
      master.gain.value = 1;
      master.connect(soften).connect(context.destination);
    }
    // A focus block may already be running when the first gesture lets audio start.
    if (context.state === 'suspended') void context.resume().then(() => setAmbience(ambienceWanted));
    else setAmbience(ambienceWanted);
  } catch {
    context = null; // no Web Audio: everything still shows visually
  }
}

export function audioContext(): AudioContext | null {
  return context;
}

export type Sound = 'tap' | 'pick' | 'drop' | 'apply' | 'undo' | 'error' | 'nudge' | 'listen' | 'grow';

// The scale (Hz): C major pentatonic over three octaves.
const C4 = 261.63, D4 = 293.66, C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880;
const C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, G6 = 1567.98, A6 = 1760;

/** [frequency, start (s after the cue), length (s), level] per note. */
type Note = readonly [number, number, number, number];
const CUES: Record<Sound, readonly Note[]> = {
  tap: [[G6, 0, 0.05, 0.05]],
  pick: [[E5, 0, 0.09, 0.08], [A5, 0.06, 0.14, 0.08]],
  drop: [[A5, 0, 0.09, 0.08], [E5, 0.06, 0.16, 0.08]],
  apply: [[C5, 0, 0.3, 0.08], [E5, 0.09, 0.3, 0.08], [G5, 0.18, 0.45, 0.09]],
  undo: [[G5, 0, 0.12, 0.07], [D5, 0.08, 0.22, 0.07]],
  error: [[D4, 0, 0.14, 0.09], [C4, 0.12, 0.2, 0.08]],
  nudge: [[E6, 0, 0.14, 0.06], [G6, 0.11, 0.22, 0.06]],
  listen: [[C5, 0, 0.1, 0.07], [G5, 0.07, 0.18, 0.07]],
  grow: [[C6, 0, 0.5, 0.06], [E6, 0.18, 0.5, 0.06], [G6, 0.36, 0.7, 0.06], [A6, 0.6, 0.9, 0.04]],
};
/** The timer's alarm: an arpeggio, twice. */
const ALARM: readonly Note[] = [0, 1.15].flatMap((t) => [[C5, t, 0.6, 0.2], [E5, t + 0.18, 0.6, 0.2], [G5, t + 0.36, 0.6, 0.2], [C6, t + 0.54, 0.9, 0.18]] as Note[]);

/** One soft mallet note into [out]. */
function mallet(ctx: AudioContext, out: AudioNode, [frequency, start, length, level]: Note, at: number): void {
  const t = at + start;
  for (const [ratio, share, decay] of [[1, 1, 1], [4.0, 0.3, 0.25]] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency * ratio;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level * share, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length * decay);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + length * decay + 0.02);
  }
}

// Where the head is, for cues placed in the room (set once by bindHead; read only when a cue plays).
let head: Object3D | null = null;
const headPosition = new Vector3();
const headRotation = new Quaternion();
const local = new Vector3();

/** The camera the listener's ears follow. */
export function bindHead(camera: Object3D): void {
  head = camera;
}

/** Where a cue goes: placed at [at] around the listener (HRTF), or straight to the mix. */
function output(ctx: AudioContext, at?: { x: number; y: number; z: number }): AudioNode {
  if (!at || !head || !master) return master ?? ctx.destination;
  head.getWorldPosition(headPosition);
  head.getWorldQuaternion(headRotation);
  local.set(at.x, at.y, at.z).sub(headPosition).applyQuaternion(headRotation.invert());
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 0.6;
  panner.rolloffFactor = 0.5;
  panner.positionX.value = local.x;
  panner.positionY.value = local.y;
  panner.positionZ.value = local.z;
  panner.connect(master);
  return panner;
}

/** A cue, from [at] in the room when given (a control, a timer, the plant). */
export function play(sound: Sound, at?: { x: number; y: number; z: number }): void {
  if (!settings.sound || !context || context.state !== 'running') return;
  const out = output(context, at);
  const now = context.currentTime + 0.01;
  for (const note of CUES[sound]) mallet(context, out, note, now);
}

/** The timer's alarm, from the timer: plays even with sounds off. */
export function alarm(at: { x: number; y: number; z: number }): void {
  if (!context || context.state !== 'running') return;
  const out = output(context, at);
  const now = context.currentTime + 0.02;
  for (const note of ALARM) mallet(context, out, note, now);
}

// Focus ambience: soft air (brown noise, low-passed) whose level breathes on a slow wave.
const AMBIENCE_LEVEL = 0.05;
const AMBIENCE_IN_S = 3;
const AMBIENCE_OUT_S = 1.5;
let ambience: { source: AudioBufferSourceNode; breath: OscillatorNode; gain: GainNode } | null = null;
let ambienceWanted = false;
let noise: AudioBuffer | null = null;

/** Four seconds of brown noise, looped: generated once. */
function brownNoise(ctx: AudioContext): AudioBuffer {
  if (noise) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return noise;
}

/** On while a focus block runs (TimerSystem says so on every change); always off with sounds off. */
export function setAmbience(on: boolean): void {
  ambienceWanted = on;
  const ctx = context;
  if (!ctx || !master || ctx.state !== 'running') return;
  if (on && settings.sound && !ambience) {
    const source = ctx.createBufferSource();
    source.buffer = brownNoise(ctx);
    source.loop = true;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 520;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(AMBIENCE_LEVEL, ctx.currentTime + AMBIENCE_IN_S);
    // A slow breath, about one every twelve seconds, a quarter of the level deep.
    const breath = ctx.createOscillator();
    breath.frequency.value = 1 / 12;
    const depth = ctx.createGain();
    depth.gain.value = AMBIENCE_LEVEL * 0.25;
    breath.connect(depth).connect(gain.gain);
    source.connect(air).connect(gain).connect(master);
    source.start();
    breath.start();
    ambience = { source, breath, gain };
  } else if ((!on || !settings.sound) && ambience) {
    const { source, breath, gain } = ambience;
    const end = ctx.currentTime + AMBIENCE_OUT_S;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.stop(end + 0.05);
    breath.stop(end + 0.05);
    ambience = null;
  }
}

onSettings(() => setAmbience(ambienceWanted));

// Read by the Playwright tests.
(window as unknown as { __sound: unknown }).__sound = { ambienceOn: () => ambience != null, running: () => context?.state === 'running' };
