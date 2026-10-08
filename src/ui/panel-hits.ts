/**
 * One pointer listener per panel instead of one per control.
 *
 * pointer-events raycasts every element that has, or whose ancestor has, a listener, for every pointer (ray, grab
 * and poke, on both hands) on every frame. With a listener on each card, a full board cost ~60 raycasts per pointer
 * per frame and the performance gate measured 109 ms frames. Here only the panel root is raycast (its children are
 * skipped with `intersectChildren = false`), and the control under the hit point is found with a rectangle test,
 * on pointer events only, without allocating.
 */
import { Matrix4, Vector3, type UIKit } from '@iwsdk/core';
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

export class PanelHits<K extends string> {
  private readonly inverse = new Matrix4();
  private readonly local = new Vector3();
  private readonly hoverByPointer = new Map<number, K>();

  /**
   * @param controls most specific first (a card before its column): the first rectangle containing the point wins.
   */
  constructor(
    root: Element,
    private readonly controls: readonly (readonly [K, Element])[],
    private readonly handlers: PanelHandlers<K>,
    cleanups: (() => void)[],
  ) {
    (root as Element & { intersectChildren?: boolean }).intersectChildren = false;
    const click = (event: PanelPointerEvent) => {
      event.stopPropagation?.();
      const key = this.hit(event.point);
      if (key == null) return;
      unlockAudio();
      play('tap');
      this.handlers.click(key);
    };
    const move = (event: PanelPointerEvent) => this.setHover(event.pointerId ?? 0, this.hit(event.point));
    const leave = (event: PanelPointerEvent) => this.setHover(event.pointerId ?? 0, null);
    root.addEventListener('click', click);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', leave);
    cleanups.push(() => {
      root.removeEventListener('click', click);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', leave);
    });
  }

  /** The control under a world-space point, or null. Hidden controls (display: none) never match. */
  hit(point: Vector3 | undefined): K | null {
    if (!point) return null;
    for (const [key, element] of this.controls) {
      if (!element.isVisible.value) continue;
      element.updateWorldMatrix(true, false);
      // UIKit maps the unit square onto each element: inside means |x|, |y| <= 0.5 in its local frame.
      this.local.copy(point).applyMatrix4(this.inverse.copy(element.matrixWorld).invert());
      if (Math.abs(this.local.x) <= 0.5 && Math.abs(this.local.y) <= 0.5) return key;
    }
    return null;
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
