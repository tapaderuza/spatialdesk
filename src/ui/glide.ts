/**
 * Panels that slide instead of jumping. When the AI or the guided setup moves the space onto the body's comfort zone
 * ("Put it within my reach", the calibration, an undo), a board that teleports half a metre breaks the room and can make
 * someone queasy; here it glides to its new place in well under a second.
 *
 * Each glide is a critically damped spring on position, yaw, pitch and scale: it starts and ends at rest, never
 * overshoots, and a new target in mid-flight carries the speed over, so two commands in a row are one smooth motion.
 * With smoothing time 0.25 s the panel is within 2% of its place after 0.75 s and exactly there (snapped, then stopped)
 * a little later. Per frame it touches only the panels still moving, with no allocation; at rest it costs one comparison.
 *
 * It slides only what the person (or the AI on their behalf) asked for. Loading, bookkeeping, the first placement,
 * a jump of more than [TELEPORT_M] (walking to another room), a panel in someone's hand, a flat screen and the reduced
 * motion preference all place at once. A glide sounds as a soft breath of air from the panel itself, following it.
 */
import { createSystem, VisibilityState, type Object3D } from '@iwsdk/core';
import { accessPreferences } from '../accessibility/preferences.js';
import { whoosh } from './sounds.js';
import type { Pose } from '../workspace/model.js';
import type { ChangeSource } from '../workspace/store.js';

/** Smoothing time of the spring (s): about 3x this to be within 2% of the place, with no overshoot. */
export const GLIDE_SMOOTH_S = 0.25;
const OMEGA = 2 / GLIDE_SMOOTH_S;
/** A frame hitch must not skip the motion: the step is capped. */
const MAX_STEP_S = 0.05;
/** A glide that has not come to rest by now (it always does, in about a second) is finished where it should be. */
const MAX_GLIDE_MS = 3_000;
/** Further than this is a re-anchor to another place, not an adjustment: no slide across a room. */
const TELEPORT_M = 3;
/**
 * Less than this is not worth a slide: it is the workspace following the head by a couple of centimetres when a button is
 * pressed (the anchor follows the viewer), which nobody sees and which must never make a panel take no pointer for a second.
 */
const SMALL_M = 0.04;
const SMALL_RAD = 0.035; // 2 degrees
const SMALL_SCALE = 0.03;
/** Position (m), angle (rad) and scale below which a channel is "there". Index: x y z yaw pitch scale. */
const REST = new Float64Array([0.0005, 0.0005, 0.0005, 0.0005, 0.0005, 0.0005]);
const CHANNELS = 6;

interface Glider {
  readonly object: Object3D;
  /** Current, velocity and target per channel: x y z yaw pitch scale. */
  readonly x: Float64Array;
  readonly v: Float64Array;
  readonly t: Float64Array;
  hold: (() => boolean) | undefined;
  moved: (() => void) | undefined;
  /** What the object's pointer-events were before the glide took them away (see [release]). */
  events: 'auto' | 'none' | 'listener' | undefined;
  /** performance.now() when it began: the watchdog of [MAX_GLIDE_MS]. */
  began: number;
}

const active: Glider[] = [];
const gliders = new WeakMap<Object3D, Glider>();
const placed = new WeakSet<Object3D>();
let immersive = false;
let settledWaiting: (() => void)[] = [];

/** Gliding happens in the headset, for people who have not asked for less motion. */
function enabled(): boolean {
  return immersive && !accessPreferences.reducedMotion;
}

/** Changes the person (or the AI for them) made slide; loading and the system's own bookkeeping place at once. */
export function glidesFor(source: ChangeSource): boolean {
  return source === 'user' || source === 'undo';
}

export interface PlaceOptions {
  /** True while someone holds the panel: the glide lets go of it. */
  hold?: () => boolean;
  /** Called after every step (and after an instant placement): anything that follows the panel, like its grab bar. */
  moved?: () => void;
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function apply(g: Glider): void {
  const { object, x } = g;
  object.position.set(x[0], x[1], x[2]);
  object.rotation.set(x[4], x[3], 0);
  object.scale.setScalar(x[5]);
  g.moved?.();
}

/**
 * A panel on the move takes no pointer: a fingertip or a controller's tip that a sliding panel runs into must not press
 * what it passes through, and nobody can aim at it meanwhile. It is given back as it was when the glide ends.
 */
type Pointable = Object3D & { pointerEvents?: 'auto' | 'none' | 'listener' };

function release(index: number): void {
  const last = active.length - 1;
  const g = active[index];
  gliders.delete(g.object);
  const pointable = g.object as Pointable;
  if (pointable.pointerEvents === 'none') pointable.pointerEvents = g.events;
  active[index] = active[last];
  active.pop();
  if (active.length === 0 && settledWaiting.length > 0) {
    const waiting = settledWaiting;
    settledWaiting = [];
    for (const callback of waiting) callback();
  }
}

/**
 * Puts [object] at [pose] and [scale]: at once, or sliding there when [smooth] (and gliding is on, and the object has been
 * placed before). Rotation order must already be YXZ, as for every pinned panel.
 */
export function placeSmoothly(object: Object3D, pose: Pose, scale: number, smooth: boolean, options: PlaceOptions = {}): void {
  const first = !placed.has(object);
  placed.add(object);
  let g = gliders.get(object);
  const p = object.position;
  const distance = Math.hypot(p.x - pose.x, p.y - pose.y, p.z - pose.z);
  const here = object.rotation;
  const small =
    distance < SMALL_M && Math.abs(wrap(pose.yaw - here.y)) < SMALL_RAD && Math.abs(pose.pitch - here.x) < SMALL_RAD && Math.abs(scale - object.scale.x) < SMALL_SCALE;
  if (first || !smooth || !enabled() || distance > TELEPORT_M || (!g && small)) {
    if (g) release(active.indexOf(g));
    object.position.set(pose.x, pose.y, pose.z);
    object.rotation.set(pose.pitch, pose.yaw, 0);
    object.scale.setScalar(scale);
    options.moved?.();
    return;
  }
  if (!g) {
    g = { object, x: new Float64Array(CHANNELS), v: new Float64Array(CHANNELS), t: new Float64Array(CHANNELS), hold: options.hold, moved: options.moved, events: (object as Pointable).pointerEvents, began: performance.now() };
    (object as Pointable).pointerEvents = 'none';
    g.x[0] = p.x; g.x[1] = p.y; g.x[2] = p.z; g.x[3] = here.y; g.x[4] = here.x; g.x[5] = object.scale.x;
    gliders.set(object, g);
    active.push(g);
    whoosh(object, distance); // a breath of air from the panel, following it (src/ui/sounds.ts)
  }
  g.hold = options.hold;
  g.moved = options.moved;
  g.t[0] = pose.x; g.t[1] = pose.y; g.t[2] = pose.z;
  g.t[3] = g.x[3] + wrap(pose.yaw - g.x[3]); // the short way round
  g.t[4] = pose.pitch;
  g.t[5] = scale;
}

/** Ends the glide of [object] where it is (someone has taken hold of it). */
export function stopGlide(object: Object3D): void {
  const g = gliders.get(object);
  if (g) release(active.indexOf(g));
}

/** Runs [callback] when nothing is gliding any more: at once if nothing is. For feedback that means "it has settled". */
export function whenSettled(callback: () => void): void {
  if (active.length === 0) callback();
  else settledWaiting.push(callback);
}

function finishAll(): void {
  for (let i = active.length - 1; i >= 0; i--) {
    const g = active[i];
    g.x.set(g.t);
    apply(g);
    release(i);
  }
}

/** One frame of every glide still moving. */
export function tickGlides(delta: number): void {
  if (active.length === 0) return;
  if (!enabled()) {
    finishAll(); // left the headset, or asked for less motion, mid-flight
    return;
  }
  const step = Math.min(delta, MAX_STEP_S);
  if (!(step > 0)) return;
  const decay = Math.exp(-OMEGA * step);
  const now = performance.now();
  for (let i = active.length - 1; i >= 0; i--) {
    const g = active[i];
    if (g.hold?.()) {
      release(i);
      continue;
    }
    if (now - g.began > MAX_GLIDE_MS) {
      g.x.set(g.t); // never left sliding, and never left unpressable
      apply(g);
      release(i);
      continue;
    }
    let atRest = true;
    for (let c = 0; c < CHANNELS; c++) {
      // The closed-form step of a critically damped spring: exact for any step, so a slow frame cannot blow it up.
      const d = g.x[c] - g.t[c];
      const lift = (g.v[c] + OMEGA * d) * step;
      g.v[c] = (g.v[c] - OMEGA * lift) * decay;
      g.x[c] = g.t[c] + (d + lift) * decay;
      if (Math.abs(g.x[c] - g.t[c]) >= REST[c] || Math.abs(g.v[c]) >= REST[c] * 10) atRest = false;
    }
    if (atRest) {
      g.x.set(g.t);
      apply(g);
      release(i);
    } else {
      apply(g);
    }
  }
}

/** Moves the panels that are gliding; follows whether the person is in the headset. Register early. */
export class GlideSystem extends createSystem({}) {
  init(): void {
    immersive = this.world.visibilityState.value !== VisibilityState.NonImmersive;
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        immersive = state !== VisibilityState.NonImmersive;
      }),
      () => {
        finishAll();
        immersive = false;
      },
    );
    // Read by the Playwright tests: how many panels are still moving.
    (window as unknown as { __glide: unknown }).__glide = { active: () => active.length, enabled };
  }

  update(delta: number): void {
    tickGlides(delta);
  }
}
