/**
 * One pointer listener per panel instead of one per control.
 *
 * pointer-events raycasts every element that has, or whose ancestor has, a listener, for every pointer (ray, grab
 * and poke, on both hands) on every frame. With a listener on each card, a full board cost ~60 raycasts per pointer
 * per frame and the performance gate measured 109 ms frames. Here only the panel root is raycast (its children are
 * skipped with `intersectChildren = false`), and the control under the hit point is found with a rectangle test,
 * on pointer events only, without allocating.
 *
 * Every live panel is also listed in [livePanels], so the hands-free gaze pointer (src/ui/gaze.ts) can find the
 * control under the centre of the view and press it the same way a tap does.
 */
import { Matrix4, Vector3, type Object3D, type UIKit } from '@iwsdk/core';
import { play, unlockAudio } from './sounds.js';

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
}

/** The gaze pointer's id among the hands' pointer ids (which are never negative). */
const GAZE_POINTER = -1;

/** What the gaze pointer needs from a panel; it only ever presses a key that gazeHit() gave it. */
export interface GazeTarget {
  rayDistance(origin: Vector3, direction: Vector3): number;
  gazeHit(point: Vector3, fresh: boolean): string | null;
  press(key: string): void;
  setGazeHover(key: string | null): void;
}

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

  /**
   * @param controls most specific first (a card before its column): the first rectangle containing the point wins.
   */
  constructor(
    private readonly root: Element,
    private readonly controls: readonly (readonly [K, Element])[],
    private readonly handlers: PanelHandlers<K>,
    cleanups: (() => void)[],
  ) {
    (root as Element & { intersectChildren?: boolean }).intersectChildren = false;
    this.rects = new Float32Array(controls.length * 4);
    const click = (event: PanelPointerEvent) => {
      event.stopPropagation?.();
      const key = this.hit(event.point);
      if (key != null) this.press(key);
    };
    const move = (event: PanelPointerEvent) => this.setHover(event.pointerId ?? 0, this.hit(event.point));
    const leave = (event: PanelPointerEvent) => this.setHover(event.pointerId ?? 0, null);
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
    unlockAudio();
    play('tap');
    this.handlers.click(key);
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

  /** The gaze pointer's hover (null: the gaze left this panel), painted like a hand's. */
  setGazeHover(key: K | null): void {
    this.setHover(GAZE_POINTER, key);
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

/** False when the panel or any parent is hidden (a closed agent card). */
function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
