/**
 * Steady aim for hands that shake (tremor mode, src/accessibility/preferences.ts). A tremor sweeps the pointer's ray
 * back and forth across the target, and the pinch or trigger itself jolts it; the control under the ray at the instant
 * of the press is often the neighbour. What the person means is the control the ray has spent most of the last moment
 * on, so that is what tremor mode presses, and what it highlights while aiming (the highlight stops flickering).
 * A press that lands between controls goes to the nearest one within [SNAP_METRES].
 *
 * Fixed-size ring buffers and a caller's scratch tally: nothing is allocated per pointer sample or per press. A model
 * of selection, measured with synthetic tremor (tests/tremor.spec.ts); not a clinical measure of anything.
 */

/** A press between controls goes to the nearest one this close (metres): about a fingertip. */
export const SNAP_METRES = 0.015;
/** The share of the recent aim a control needs before it is the intended one. */
export const MIN_SHARE = 0.4;

/** One pointer's recent aim: when each sample was taken and which control it was on (-1: none). */
export class AimTrail {
  private readonly times: Float64Array;
  private readonly keys: Int16Array;
  private head = 0;
  private count = 0;

  constructor(capacity = 96) {
    this.times = new Float64Array(capacity);
    this.keys = new Int16Array(capacity);
  }

  record(now: number, key: number): void {
    this.times[this.head] = now;
    this.keys[this.head] = key;
    this.head = (this.head + 1) % this.times.length;
    if (this.count < this.times.length) this.count++;
  }

  clear(): void {
    this.count = 0;
  }

  /**
   * The control the pointer has been on for the largest share of the last [windowMs] (each sample holds until the
   * next one, the newest until [now]), or -1 when none reaches [minShare]. [tally] is the caller's scratch, one slot
   * per control.
   */
  intended(now: number, windowMs: number, tally: Float64Array, minShare = MIN_SHARE): number {
    tally.fill(0);
    const from = now - windowMs;
    let until = now;
    let total = 0;
    for (let n = 0; n < this.count; n++) {
      const i = (this.head - 1 - n + this.times.length) % this.times.length;
      const at = this.times[i];
      const start = at > from ? at : from;
      if (until > start) {
        const held = until - start;
        total += held;
        const key = this.keys[i];
        if (key >= 0 && key < tally.length) tally[key] += held;
      }
      if (at <= from) break;
      until = at;
    }
    if (total <= 0) return -1;
    let best = -1;
    for (let k = 0; k < tally.length; k++) if (tally[k] > 0 && (best < 0 || tally[k] > tally[best])) best = k;
    return best >= 0 && tally[best] / total >= minShare ? best : -1;
  }
}

/** How far (metres) a point is outside a width x height rectangle, given its offset from the centre; 0 inside. */
export function outside(dx: number, dy: number, width: number, height: number): number {
  const x = Math.max(0, Math.abs(dx) - width / 2);
  const y = Math.max(0, Math.abs(dy) - height / 2);
  return Math.hypot(x, y);
}
