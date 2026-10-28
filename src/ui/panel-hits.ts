/**
 * One pointer listener per panel instead of one per control.
 *
 * pointer-events raycasts every element that has, or whose ancestor has, a listener, for every pointer (ray and grab,
 * on both hands) on every frame. With a listener on each card, a full board cost ~60 raycasts per pointer
 * per frame and the performance gate measured 109 ms frames. Here only the panel root is raycast (its children are
 * skipped with `intersectChildren = false`), and the control under the hit point is found with a rectangle test,
 * on pointer events only, without allocating.
 *
 * Every live panel is also listed in [livePanels], so the hands-free gaze pointer (src/ui/gaze.ts) can find the
 * control under the centre of the view and press it the same way a tap does, a fingertip can push it (src/ui/poke.ts),
 * and the agent can be told what "this" is (src/ui/attention.ts).
 */
import { Matrix4, Vector3, type Object3D, type UIKit } from '@iwsdk/core';
import { play, unlockAudio } from './sounds.js';
import { accessPreferences } from '../accessibility/preferences.js';
import { AimTrail, outside, SNAP_METRES } from './aim.js';
import { reachState } from '../accessibility/reach.js';
import type { Referent } from './attention.js';

type Element = UIKit.Text;

interface PanelPointerEvent {
  point?: Vector3;
  pointerId?: number;
  stopPropagation?: () => void;
}

export interface PanelHandlers<K extends string> {
  click: (key: K) => void;
  /** Called when a control starts or stops being under any pointer. */
  hover?: (key: K, hovered: boolean) => void;
  /** What a control (null: the panel itself) stands for, when the user can call it "this" (src/ui/attention.ts). */
  refer?: (key: K | null) => Referent | null;
}

/** The gaze pointer's id among the hands' pointer ids (which are never negative). */
const GAZE_POINTER = -1;

/** What the gaze pointer needs from a panel; it only ever presses a key that gazeHit() gave it. */
export interface GazeTarget {
  rayDistance(origin: Vector3, direction: Vector3): number;
  gazeHit(point: Vector3, fresh: boolean): string | null;
  press(key: string): void;
  setGazeHover(key: string | null): void;
  /** What the control stands for, if it can be "this" for the agent; null for the command panel and the like. */
  refer(key: string | null): Referent | null;
  /** Direct touch (src/ui/poke.ts): how far a fingertip is in front, the control under it, its highlight. */
  touchDistance(tip: Vector3, margin: number): number;
  touchFace(point: Vector3, normal: Vector3): void;
  pokeHit(fresh: boolean): string | null;
  setPokeHover(hand: 0 | 1, key: string | null): void;
  /** For one-switch scanning (src/accessibility/switch-system.ts): which panel, shown or not, its visible controls. */
  readonly name: string;
  readonly modal: boolean;
  isShown(): boolean;
  visibleKeys(out: string[]): string[];
  setScanHover(key: string | null): void;
  /** A shown control's world matrix (it maps the unit square onto the control) into [out]; false when hidden. */
  matrixOf(key: string, out: Matrix4): boolean;
}

/** Which panel this is and whether it takes over while shown (the agent's card): for one-switch scanning. */
export interface PanelOptions {
  name?: string;
  modal?: boolean;
}

/** The one switch's highlight among the pointers (gaze is -1). */
const SWITCH_POINTER = -2;
/** Each hand's direct touch, left and right (src/ui/poke.ts). */
const POKE_POINTERS = [-3, -4] as const;

/** How long the gaze reuses a panel's control rectangles before measuring them again (layout may have moved). */
const RECTS_MAX_AGE_MS = 250;

/** Panels that can be pressed right now or later, in creation order. An array: walked per frame without allocating. */
export const livePanels: GazeTarget[] = [];

export class PanelHits<K extends string> {
  private readonly inverse = new Matrix4();
  private readonly rootInverse = new Matrix4();
  private readonly relative = new Matrix4();
  private readonly local = new Vector3();
  private readonly far = new Vector3();
  private readonly hoverByPointer = new Map<number, K>();
  /** Each control's rectangle in the root's frame, [minX, maxX, minY, maxY] per control, for the gaze. */
  private readonly rects: Float32Array;
  private rectsAt = -Infinity;
  /** Where the fingertip last measured by touchDistance() is over the panel, in the root's unit square. */
  private touchU = 0;
  private touchV = 0;
  /** ... and the face's unit normal. */
  private readonly touchNormal = new Vector3();
  private lastPressKey: K | null = null;
  private lastPressAt = -Infinity;
  /** Tremor mode: each pointer's recent aim, and a scratch tally, one slot per control (src/ui/aim.ts). */
  private readonly trails = new Map<number, AimTrail>();
  private readonly tally: Float64Array;

  /**
   * @param controls most specific first (a card before its column): the first rectangle containing the point wins.
   */
  readonly name: string;
  readonly modal: boolean;

  constructor(
    private readonly root: Element,
    private readonly controls: readonly (readonly [K, Element])[],
    private readonly handlers: PanelHandlers<K>,
    cleanups: (() => void)[],
    options: PanelOptions = {},
  ) {
    this.name = options.name ?? '';
    this.modal = options.modal ?? false;
    (root as Element & { intersectChildren?: boolean }).intersectChildren = false;
    this.rects = new Float32Array(controls.length * 4);
    this.tally = new Float64Array(controls.length);
    const click = (event: PanelPointerEvent) => {
      event.stopPropagation?.();
      // One-switch mode: the switch selects what is lit; a pinch must not also press what the ray points at. Nor
      // while a reach is measured (src/accessibility/reach.ts): that pinch is a measurement.
      if (accessPreferences.switchEnabled || reachState.measuring) return;
      const key = accessPreferences.tremorTolerance ? this.steadyHit(event.pointerId ?? 0, event.point) : this.hit(event.point);
      if (key != null) this.press(key);
    };
    const move = (event: PanelPointerEvent) => {
      const pointer = event.pointerId ?? 0;
      const key = this.hit(event.point);
      if (!accessPreferences.tremorTolerance) {
        this.setHover(pointer, key);
        return;
      }
      // Tremor mode: the highlight follows the control aimed at, as the press will.
      const now = performance.now();
      const trail = this.trail(pointer);
      trail.record(now, this.indexOf(key));
      const aimed = trail.intended(now, accessPreferences.aimWindowMs, this.tally);
      this.setHover(pointer, aimed >= 0 ? this.controls[aimed][0] : key);
    };
    const leave = (event: PanelPointerEvent) => {
      // A tremor can take the ray off the panel for a moment: that counts as aiming at nothing, not a fresh start.
      this.trails.get(event.pointerId ?? 0)?.record(performance.now(), -1);
      this.setHover(event.pointerId ?? 0, null);
    };
    root.addEventListener('click', click);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', leave);
    livePanels.push(this);
    cleanups.push(() => {
      root.removeEventListener('click', click);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', leave);
      const index = livePanels.indexOf(this);
      if (index >= 0) livePanels.splice(index, 1);
    });
  }

  /** Presses a control as a tap would: the tap sound, then the panel's own action. */
  press(key: K): void {
    if (!this.root.isVisible.value || !shown(this.root)) return;
    let visible = false;
    for (let i = 0; i < this.controls.length; i++) if (this.controls[i][0] === key) { visible = this.controls[i][1].isVisible.value; break; }
    if (!visible) return;
    const now = performance.now();
    if (accessPreferences.tremorTolerance && this.lastPressKey === key && now - this.lastPressAt < accessPreferences.clickCooldownMs) return;
    this.lastPressKey = key;
    this.lastPressAt = now;
    unlockAudio();
    play('tap', this.positionOf(key));
    this.handlers.click(key);
  }

  /**
   * Tremor mode's press: the control aimed at for most of the last moment (the jolt of the pinch does not count),
   * else the one under the point, else the nearest within a fingertip.
   */
  private steadyHit(pointer: number, point: Vector3 | undefined): K | null {
    const trail = this.trails.get(pointer);
    if (trail) {
      const aimed = trail.intended(performance.now(), accessPreferences.aimWindowMs, this.tally);
      if (aimed >= 0 && this.controls[aimed][1].isVisible.value) return this.controls[aimed][0];
    }
    return this.hit(point) ?? this.nearest(point);
  }

  /** The visible control whose rectangle is nearest a point that is on none, within [SNAP_METRES]. Allocation-free. */
  private nearest(point: Vector3 | undefined): K | null {
    if (!point) return null;
    let best: K | null = null;
    let bestDistance = SNAP_METRES;
    for (let i = 0; i < this.controls.length; i++) {
      const [key, element] = this.controls[i];
      if (!element.isVisible.value) continue;
      element.updateWorldMatrix(true, false);
      this.local.copy(point).applyMatrix4(this.inverse.copy(element.matrixWorld).invert());
      const e = element.matrixWorld.elements;
      const width = Math.hypot(e[0], e[1], e[2]);
      const height = Math.hypot(e[4], e[5], e[6]);
      const distance = outside(this.local.x * width, this.local.y * height, width, height);
      if (distance <= bestDistance) {
        best = key;
        bestDistance = distance;
      }
    }
    return best;
  }

  private trail(pointer: number): AimTrail {
    let trail = this.trails.get(pointer);
    if (!trail) this.trails.set(pointer, (trail = new AimTrail()));
    return trail;
  }

  private indexOf(key: K | null): number {
    if (key == null) return -1;
    for (let i = 0; i < this.controls.length; i++) if (this.controls[i][0] === key) return i;
    return -1;
  }

  /** Where a control is in the room (a shared scratch vector: read it at once). */
  private positionOf(key: K): Vector3 | undefined {
    const element = this.controls.find(([k]) => k === key)?.[1];
    return element ? element.getWorldPosition(this.far) : undefined;
  }

  /** The control under a world-space point, or null. Hidden controls (display: none) never match. Allocation-free. */
  hit(point: Vector3 | undefined): K | null {
    if (!point) return null;
    for (let i = 0; i < this.controls.length; i++) {
      const [key, element] = this.controls[i];
      if (!element.isVisible.value) continue;
      element.updateWorldMatrix(true, false);
      // UIKit maps the unit square onto each element: inside means |x|, |y| <= 0.5 in its local frame.
      this.local.copy(point).applyMatrix4(this.inverse.copy(element.matrixWorld).invert());
      if (Math.abs(this.local.x) <= 0.5 && Math.abs(this.local.y) <= 0.5) return key;
    }
    return null;
  }

  /**
   * How far along a world-space ray (origin + t * direction) its front face is, or -1 when the ray misses it, comes
   * from behind, or the panel is not shown. Panels face +Z, so a ray toward one travels to -Z in its frame.
   */
  rayDistance(origin: Vector3, direction: Vector3): number {
    if (!this.root.isVisible.value || !shown(this.root)) return -1;
    this.root.updateWorldMatrix(true, false);
    this.rootInverse.copy(this.root.matrixWorld).invert();
    const near = this.local.copy(origin).applyMatrix4(this.rootInverse);
    const far = this.far.copy(origin).add(direction).applyMatrix4(this.rootInverse);
    const dz = far.z - near.z;
    if (near.z <= 0 || dz >= 0) return -1;
    const t = -near.z / dz;
    const x = near.x + t * (far.x - near.x);
    const y = near.y + t * (far.y - near.y);
    return Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5 ? t : -1;
  }

  /**
   * hit() for the gaze, right after rayDistance() on this panel: the point is compared with rectangles kept in the
   * panel's own frame, so a test costs a few comparisons instead of a matrix chain per control. They are measured
   * again when [fresh] (the gaze just came to this panel) or after RECTS_MAX_AGE_MS. Hidden controls never match.
   */
  gazeHit(point: Vector3, fresh: boolean): K | null {
    const now = performance.now();
    if (fresh || now - this.rectsAt > RECTS_MAX_AGE_MS) this.measureRects(now);
    const local = this.local.copy(point).applyMatrix4(this.rootInverse);
    for (let i = 0; i < this.controls.length; i++) {
      const [key, element] = this.controls[i];
      if (!element.isVisible.value) continue;
      const r = i * 4;
      if (local.x >= this.rects[r] && local.x <= this.rects[r + 1] && local.y >= this.rects[r + 2] && local.y <= this.rects[r + 3]) return key;
    }
    return null;
  }

  /** Each control's unit square, mapped into the root's frame (UIKit never rotates an element within its panel). */
  private measureRects(now: number): void {
    this.rectsAt = now;
    for (let i = 0; i < this.controls.length; i++) {
      const element = this.controls[i][1];
      element.updateWorldMatrix(true, false);
      this.relative.multiplyMatrices(this.rootInverse, element.matrixWorld);
      const a = this.local.set(-0.5, -0.5, 0).applyMatrix4(this.relative);
      const ax = a.x;
      const ay = a.y;
      const b = this.local.set(0.5, 0.5, 0).applyMatrix4(this.relative);
      const r = i * 4;
      this.rects[r] = Math.min(ax, b.x);
      this.rects[r + 1] = Math.max(ax, b.x);
      this.rects[r + 2] = Math.min(ay, b.y);
      this.rects[r + 3] = Math.max(ay, b.y);
    }
  }

  refer(key: K | null): Referent | null {
    return this.handlers.refer?.(key) ?? null;
  }

  /**
   * How far [tip] is in front of the panel's face, in metres (negative: behind it), when it is over the panel (within
   * [margin] metres of its edges) and the panel is shown and taking pointers (not gliding); NaN otherwise. Reads the
   * matrix as last drawn, with no inverse: three dot products. Remembers where the tip is, for pokeHit().
   */
  touchDistance(tip: Vector3, margin: number): number {
    const e = this.root.matrixWorld.elements;
    const dx = tip.x - e[12];
    const dy = tip.y - e[13];
    const dz = tip.z - e[14];
    // The root maps the unit square onto the panel: its x and y columns are the panel's width and height.
    const xx = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
    const yy = e[4] * e[4] + e[5] * e[5] + e[6] * e[6];
    const u = (dx * e[0] + dy * e[1] + dz * e[2]) / xx;
    const v = (dx * e[4] + dy * e[5] + dz * e[6]) / yy;
    if (Math.abs(u) > 0.5 + margin / Math.sqrt(xx) || Math.abs(v) > 0.5 + margin / Math.sqrt(yy)) return NaN;
    if (!this.root.isVisible.value || !touchable(this.root)) return NaN;
    this.touchU = u;
    this.touchV = v;
    // The face looks along x cross y (+Z in the panel's frame).
    const n = this.touchNormal.set(e[1] * e[6] - e[2] * e[5], e[2] * e[4] - e[0] * e[6], e[0] * e[5] - e[1] * e[4]).normalize();
    return dx * n.x + dy * n.y + dz * n.z;
  }

  /** Where the fingertip touchDistance() just measured meets the face (straight in), and the face's normal. */
  touchFace(point: Vector3, normal: Vector3): void {
    const e = this.root.matrixWorld.elements;
    point.set(
      e[12] + e[0] * this.touchU + e[4] * this.touchV,
      e[13] + e[1] * this.touchU + e[5] * this.touchV,
      e[14] + e[2] * this.touchU + e[6] * this.touchV,
    );
    normal.copy(this.touchNormal);
  }

  /** The control under the fingertip touchDistance() just measured, from the rectangles gazeHit() also uses. */
  pokeHit(fresh: boolean): K | null {
    const now = performance.now();
    if (fresh || now - this.rectsAt > RECTS_MAX_AGE_MS) {
      this.root.updateWorldMatrix(true, false);
      this.rootInverse.copy(this.root.matrixWorld).invert();
      this.measureRects(now);
    }
    for (let i = 0; i < this.controls.length; i++) {
      if (!this.controls[i][1].isVisible.value) continue;
      const r = i * 4;
      if (this.touchU >= this.rects[r] && this.touchU <= this.rects[r + 1] && this.touchV >= this.rects[r + 2] && this.touchV <= this.rects[r + 3]) return this.controls[i][0];
    }
    return null;
  }

  /** A hand's direct-touch highlight (null: the finger left), painted like any hover. */
  setPokeHover(hand: 0 | 1, key: K | null): void {
    this.setHover(POKE_POINTERS[hand], key);
  }

  /** The gaze pointer's hover (null: the gaze left this panel), painted like a hand's. */
  setGazeHover(key: K | null): void {
    this.setHover(GAZE_POINTER, key);
  }

  /** The one switch's highlight, painted like a hover. */
  setScanHover(key: K | null): void {
    this.setHover(SWITCH_POINTER, key);
  }

  /** Shown now (a closed agent card is not). */
  isShown(): boolean {
    return this.root.isVisible.value && shown(this.root);
  }

  /** The visible controls' keys, in order, into [out] (cleared first). */
  visibleKeys(out: string[]): string[] {
    out.length = 0;
    for (let i = 0; i < this.controls.length; i++) if (this.controls[i][1].isVisible.value) out.push(this.controls[i][0]);
    return out;
  }

  matrixOf(key: K, out: Matrix4): boolean {
    const i = this.indexOf(key);
    if (i < 0 || !this.isShown()) return false;
    const element = this.controls[i][1];
    if (!element.isVisible.value) return false;
    element.updateWorldMatrix(true, false);
    out.copy(element.matrixWorld);
    return true;
  }

  private setHover(pointerId: number, key: K | null): void {
    const previous = this.hoverByPointer.get(pointerId) ?? null;
    if (previous === key) return;
    if (key == null) this.hoverByPointer.delete(pointerId);
    else this.hoverByPointer.set(pointerId, key);
    if (!this.handlers.hover) return;
    if (previous != null && !this.isHovered(previous)) this.handlers.hover(previous, false);
    if (key != null) this.handlers.hover(key, true);
  }

  private isHovered(key: K): boolean {
    for (const hovered of this.hoverByPointer.values()) if (hovered === key) return true;
    return false;
  }
}

/**
 * Shown and taking pointers: false when it or a parent is hidden, or when the nearest pointerEvents set on the way up
 * is 'none' (a gliding panel, a closed card), exactly as pointer-events itself decides for a pinch.
 */
function touchable(object: Object3D): boolean {
  let decided = false;
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (!o.visible) return false;
    const events = (o as Object3D & { pointerEvents?: string }).pointerEvents;
    if (!decided && events !== undefined) {
      if (events === 'none') return false;
      decided = true;
    }
  }
  return true;
}

/** False when the panel or any parent is hidden (a closed agent card). */
function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
