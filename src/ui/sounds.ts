/**
 * The sound of SpatialDesk, synthesised with Web Audio (no files, no licences). Every cue is the same soft mallet (a
 * sine with a quickly fading fourth partial, through a gentle low-pass), tuned to one pentatonic scale, so the cues
 * belong to one instrument and never clash when they overlap. They sound from where things happen: a faint tick from a
 * control a pointer comes onto (at most one every 120 ms), a tap from the control, the alarm from the timer, the plant's notes from the plant, and a breath of air from a panel gliding to its
 * place, following it as it moves (HRTF). Every cue still sounding is kept where it is in the room as the head turns:
 * its place relative to the ears is recomputed each frame (SpatialAudioSystem), for at most [MAX_VOICES] at once and
 * at no cost when none sounds. During a focus block a quiet ambience of soft air, breathing slowly, fades in, and out
 * again when the block pauses or ends. Everything follows the Sound setting except the timer's alarm, which is
 * information, not decoration.
 */
import { createSystem, Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import { onSettings, settings } from './settings.js';
import { accessPreferences, onAccessPreferences } from '../accessibility/preferences.js';

let context: AudioContext | null = null;
let master: GainNode | null = null;
let cuesBus: GainNode | null = null;
let ambienceBus: GainNode | null = null;

function applyAccessMix(): void {
  if (!context || !master) return;
  const at = context.currentTime;
  cuesBus?.gain.setTargetAtTime(accessPreferences.cuesVolume, at, 0.03);
  ambienceBus?.gain.setTargetAtTime(accessPreferences.ambienceVolume, at, 0.03);
  master.channelCount = accessPreferences.monoAudio ? 1 : 2;
  master.channelCountMode = accessPreferences.monoAudio ? 'explicit' : 'max';
}

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
      cuesBus = context.createGain();
      cuesBus.gain.value = accessPreferences.cuesVolume;
      cuesBus.connect(master);
      ambienceBus = context.createGain();
      ambienceBus.gain.value = accessPreferences.ambienceVolume;
      ambienceBus.connect(master);
      applyAccessMix();
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

export type Sound = 'tick' | 'tap' | 'pick' | 'drop' | 'apply' | 'undo' | 'error' | 'nudge' | 'listen' | 'grow' | 'call' | 'welcome';

// The scale (Hz): C major pentatonic over three octaves.
const C4 = 261.63, D4 = 293.66, C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880;
const C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, G6 = 1567.98, A6 = 1760;

/** [frequency, start (s after the cue), length (s), level] per note. */
type Note = readonly [number, number, number, number];
const CUES: Record<Sound, readonly Note[]> = {
  // The faintest cue: a pointer comes onto something new that can be pressed. A quarter of a tap's level, half its length.
  tick: [[A6, 0, 0.025, 0.012]],
  tap: [[G6, 0, 0.05, 0.05]],
  pick: [[E5, 0, 0.09, 0.08], [A5, 0.06, 0.14, 0.08]],
  drop: [[A5, 0, 0.09, 0.08], [E5, 0.06, 0.16, 0.08]],
  apply: [[C5, 0, 0.3, 0.08], [E5, 0.09, 0.3, 0.08], [G5, 0.18, 0.45, 0.09]],
  undo: [[G5, 0, 0.12, 0.07], [D5, 0.08, 0.22, 0.07]],
  error: [[D4, 0, 0.14, 0.09], [C4, 0.12, 0.2, 0.08]],
  nudge: [[E6, 0, 0.14, 0.06], [G6, 0.11, 0.22, 0.06]],
  listen: [[C5, 0, 0.1, 0.07], [G5, 0.07, 0.18, 0.07]],
  grow: [[C6, 0, 0.5, 0.06], [E6, 0.18, 0.5, 0.06], [G6, 0.36, 0.7, 0.06], [A6, 0.6, 0.9, 0.04]],
  // The companion calling you back to the work (a soft question), and welcoming you when you look back.
  call: [[A5, 0, 0.25, 0.06], [E6, 0.2, 0.45, 0.05]],
  welcome: [[E5, 0, 0.12, 0.06], [G5, 0.08, 0.14, 0.06], [C6, 0.16, 0.4, 0.06]],
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

// Where the head is, for cues placed in the room (set once by bindHead).
let head: Object3D | null = null;
const headPosition = new Vector3();
const headInverse = new Quaternion();
const local = new Vector3();

/** The camera the listener's ears follow. */
export function bindHead(camera: Object3D): void {
  head = camera;
}

/**
 * A cue sounding from somewhere in the room. The listener stays at the origin facing -Z, and each panner is placed
 * where its cue is relative to the ears: so it is placed again every frame while it sounds ([tickVoices]), from where it
 * started or from the object it follows (a gliding panel). A fixed pool, reused: no allocation per frame.
 */
interface Voice {
  panner: PannerNode | null;
  kind: string;
  readonly at: Vector3;
  follow: Object3D | null;
  /** The context time it has finished by. */
  until: number;
}
const MAX_VOICES = 12;
const voices: Voice[] = Array.from({ length: MAX_VOICES }, () => ({ panner: null, kind: '', at: new Vector3(), follow: null, until: 0 }));
let liveVoices = 0;
/** Where each kind of cue last sounded from, for the tests (a click is over in a tenth of a second). */
const lastPlace = new Map<string, { x: number; y: number; z: number }>();
/** Panner moves are ramped over a frame or two: no zipper noise as the head turns. */
const RAMP_S = 0.03;

/** [world] relative to the ears (a shared scratch vector: read it at once). The head must have been read. */
function toEars(world: Vector3): Vector3 {
  return local.copy(world).sub(headPosition).applyQuaternion(headInverse);
}

function readHead(camera: Object3D): void {
  camera.getWorldPosition(headPosition);
  camera.getWorldQuaternion(headInverse).invert();
}

/**
 * Where a cue goes: placed at [at] around the listener (HRTF) and kept there until [until] (context time), following
 * [follow] when given; or straight to the mix (no place given, mono audio, or no head yet).
 */
function output(ctx: AudioContext, kind: string, until: number, at?: { x: number; y: number; z: number }, follow?: Object3D): AudioNode {
  const bus = cuesBus ?? master ?? ctx.destination;
  if (!at || !head || !master || accessPreferences.monoAudio) return bus;
  readHead(head);
  // A free voice, else the one that ends soonest (its cue keeps its last place).
  let voice = voices[0];
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = voices[i];
    if (!v.panner) {
      voice = v;
      break;
    }
    if (v.until < voice.until) voice = v;
  }
  if (!voice.panner) liveVoices++;
  voice.at.set(at.x, at.y, at.z);
  lastPlace.set(kind, { x: at.x, y: at.y, z: at.z });
  voice.kind = kind;
  voice.follow = follow ?? null;
  voice.until = until;
  const panner = (voice.panner = ctx.createPanner());
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 0.6;
  panner.rolloffFactor = 0.5;
  const ears = toEars(voice.at);
  panner.positionX.value = ears.x;
  panner.positionY.value = ears.y;
  panner.positionZ.value = ears.z;
  panner.connect(bus);
  return panner;
}

/** Every frame while cues sound: each one placed again around the ears, at its place or its moving object's. */
export function tickVoices(): void {
  if (liveVoices === 0 || !context || !head) return;
  const now = context.currentTime;
  readHead(head);
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = voices[i];
    if (!v.panner) continue;
    if (now > v.until) {
      v.panner = null;
      v.follow = null;
      liveVoices--;
      continue;
    }
    if (v.follow) v.follow.getWorldPosition(v.at);
    const ears = toEars(v.at);
    const end = now + RAMP_S;
    v.panner.positionX.linearRampToValueAtTime(ears.x, end);
    v.panner.positionY.linearRampToValueAtTime(ears.y, end);
    v.panner.positionZ.linearRampToValueAtTime(ears.z, end);
  }
}

/** When the last of [notes], starting at [at], has died away (context time). */
function endOf(notes: readonly Note[], at: number): number {
  let end = at;
  for (const [, start, length] of notes) end = Math.max(end, at + start + length + 0.05);
  return end;
}

/** A cue, from [at] in the room when given (a control, a timer, the plant). */
export function play(sound: Sound, at?: { x: number; y: number; z: number }): void {
  if (!settings.sound || accessPreferences.cuesVolume === 0 || !context || context.state !== 'running') return;
  const now = context.currentTime + 0.01;
  const out = output(context, sound, endOf(CUES[sound], now), at);
  for (const note of CUES[sound]) mallet(context, out, note, now);
}

/** No two hover ticks closer than this: a ray or the eyes sweeping across a column tick a few times, never a buzz. */
const TICK_GAP_MS = 120;
let lastTickMs = -Infinity;
/** Ticks let through and held back, and when the last few sounded (performance.now()): for the tests. */
const ticks = { played: 0, held: 0, at: [] as number[] };

/**
 * A tick from [at] as a pointer (a ray, a fingertip, the eyes) comes onto a new control, at most one every
 * [TICK_GAP_MS] (the first of a sweep sounds at once, the ones right after it are dropped, never delayed). Scheduled 5 ms
 * ahead instead of a cue's 10: it must land with the highlight.
 */
export function hoverTick(at?: { x: number; y: number; z: number }): void {
  const nowMs = performance.now();
  if (nowMs - lastTickMs < TICK_GAP_MS) {
    ticks.held++;
    return;
  }
  lastTickMs = nowMs;
  ticks.played++;
  ticks.at.push(nowMs);
  if (ticks.at.length > 16) ticks.at.shift();
  if (!settings.sound || accessPreferences.cuesVolume === 0 || !context || context.state !== 'running') return;
  const now = context.currentTime + 0.005;
  const out = output(context, 'tick', endOf(CUES.tick, now), at);
  for (const note of CUES.tick) mallet(context, out, note, now);
}

/** The timer's alarm, from the timer: plays even with sounds off. */
export function alarm(at: { x: number; y: number; z: number }): void {
  if (accessPreferences.cuesVolume === 0 || !context || context.state !== 'running') return;
  const now = context.currentTime + 0.02;
  const out = output(context, 'alarm', endOf(ALARM, now), at);
  for (const note of ALARM) mallet(context, out, note, now);
}

// The glide's breath of air: noise through a band that opens and closes with the motion, softer for a short move.
const WHOOSH_S = 0.75;
const WHOOSH_LEVEL = 0.14;
/** Several panels gliding together (the space moved for comfort) breathe as one: each further one is softer. */
const MAX_WHOOSHES = 4;
let whiteNoise: AudioBuffer | null = null;
const startPlace = new Vector3();

/** A breath of air from [object] as it glides [metres] to its place, following it while it moves (src/ui/glide.ts). */
export function whoosh(object: Object3D, metres: number): void {
  const ctx = context;
  if (!settings.sound || accessPreferences.cuesVolume === 0 || !ctx || ctx.state !== 'running') return;
  let sounding = 0;
  for (let i = 0; i < MAX_VOICES; i++) if (voices[i].panner && voices[i].kind === 'whoosh' && voices[i].until > ctx.currentTime) sounding++;
  if (sounding >= MAX_WHOOSHES) return;
  if (!whiteNoise) {
    whiteNoise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * WHOOSH_S), ctx.sampleRate);
    const data = whiteNoise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + 0.01;
  const out = output(ctx, 'whoosh', t + WHOOSH_S + 0.05, object.getWorldPosition(startPlace), object);
  const source = ctx.createBufferSource();
  source.buffer = whiteNoise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 0.9;
  band.frequency.setValueAtTime(320, t);
  band.frequency.exponentialRampToValueAtTime(1100, t + 0.22);
  band.frequency.exponentialRampToValueAtTime(420, t + WHOOSH_S);
  const gain = ctx.createGain();
  const level = (WHOOSH_LEVEL * Math.min(1, Math.max(0.4, metres / 0.6))) / (1 + sounding);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(level, t + 0.16);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + WHOOSH_S);
  source.connect(band).connect(gain).connect(out);
  source.start(t);
  source.stop(t + WHOOSH_S + 0.02);
}

/** Keeps every sounding cue where it is in the room as the head turns. Register after the systems that move panels. */
export class SpatialAudioSystem extends createSystem({}) {
  update(): void {
    tickVoices();
  }
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
  if (on && settings.sound && accessPreferences.ambienceVolume > 0 && !ambience) {
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
    source.connect(air).connect(gain).connect(ambienceBus ?? master);
    source.start();
    breath.start();
    ambience = { source, breath, gain };
  } else if ((!on || !settings.sound || accessPreferences.ambienceVolume === 0) && ambience) {
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
onAccessPreferences(() => { applyAccessMix(); setAmbience(ambienceWanted); });

// Read by the Playwright tests.
(window as unknown as { __sound: unknown }).__sound = {
  ambienceOn: () => ambience != null,
  running: () => context?.state === 'running',
  mix: () => ({ cues: cuesBus?.gain.value ?? 0, ambience: ambienceBus?.gain.value ?? 0, channels: master?.channelCount ?? 2 }),
  /** Where a kind of cue last sounded from in the room. */
  lastPlace: (kind: string) => lastPlace.get(kind) ?? null,
  /** Hover ticks let through and held back by the gap between them. */
  ticks: () => ({ played: ticks.played, held: ticks.held, at: [...ticks.at] }),
  /** The cues sounding from a place: what, where in the room, and where around the ears its panner has it now. */
  voices: () =>
    voices
      .filter((v) => v.panner && context && v.until > context.currentTime)
      .map((v) => ({
        kind: v.kind,
        follows: v.follow?.name ?? null,
        at: { x: v.at.x, y: v.at.y, z: v.at.z },
        ears: { x: v.panner!.positionX.value, y: v.panner!.positionY.value, z: v.panner!.positionZ.value },
      })),
};
