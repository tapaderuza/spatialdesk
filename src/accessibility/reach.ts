/**
 * Fit to my reach: the user reaches out to where a board would be comfortable and pinches, and that one point gives
 * the comfort profile's distance, height and side, measured by her own hand instead of chosen from a menu. Lying on a
 * sofa, the hand rises and comes closer; sitting in a wheelchair with a short reach, it stays near and low.
 *
 * The inverse of the shared Layout's placement (server/shared/.../Layout.kt): the focus board sits [reach] times
 * FOCUS_DISTANCE from the eyes, FOCUS_ELEVATION_DEG below them, the whole layout turned [tiltDeg] up round the eyes.
 * So the pinch point's distance gives reach, its elevation gives tilt, and its bearing gives the side. Pure: no World.
 */
import type { Comfort } from '../workspace/model.js';

/** The focus board's slot in Layout.kt: 0.62 m ahead, 0.17 m below the eyes. */
const FOCUS_DISTANCE = Math.hypot(0.62, 0.17);
const FOCUS_ELEVATION_DEG = (Math.atan2(-0.17, 0.62) * 180) / Math.PI;
/** Within this bearing the board stays centred; beyond it the layout leans to that side. */
const SIDE_DEG = 12;
/** Nearer than this, the pinch was not a reach (a hand resting on the lap or by the face). */
export const MIN_REACH_M = 0.25;
const LIMITS = { reach: [0.5, 1.8], tiltDeg: [-25, 30] } as const;

/** While measuring, a pinch is a measurement: it must not also press what its ray points at (src/ui/panel-hits.ts). */
export const reachState = { measuring: false };

export interface Point { x: number; y: number; z: number }
export interface Anchor extends Point { yaw: number }

export interface Reach {
  /** What the comfort profile becomes (scale and turn are left as they are). */
  comfort: Pick<Comfort, 'reach' | 'tiltDeg' | 'side'>;
  /** What was measured, for the card: metres from the eyes, degrees above (+) them, degrees to the right (+). */
  distanceM: number;
  elevationDeg: number;
  bearingDeg: number;
}

const clamp = (v: number, [low, high]: readonly [number, number]) => Math.min(high, Math.max(low, v));
const deg = (rad: number) => (rad * 180) / Math.PI;

/** Null when the hand was too near the eyes, or behind them, to be a reach. */
export function comfortFromReach(anchor: Anchor, hand: Point): Reach | null {
  const wx = hand.x - anchor.x;
  const wy = hand.y - anchor.y;
  const wz = hand.z - anchor.z;
  // Into the anchor's frame: x to the right, f ahead (yaw turns the forward -Z toward -X, to the left).
  const right = wx * Math.cos(anchor.yaw) - wz * Math.sin(anchor.yaw);
  const ahead = -wx * Math.sin(anchor.yaw) - wz * Math.cos(anchor.yaw);
  const distanceM = Math.hypot(right, wy, ahead);
  if (distanceM < MIN_REACH_M || ahead <= 0) return null;
  const elevationDeg = deg(Math.atan2(wy, Math.hypot(right, ahead)));
  const bearingDeg = deg(Math.atan2(right, ahead));
  return {
    comfort: {
      reach: Math.round(clamp(distanceM / FOCUS_DISTANCE, LIMITS.reach) * 20) / 20,
      tiltDeg: Math.round(clamp(elevationDeg - FOCUS_ELEVATION_DEG, LIMITS.tiltDeg)) + 0, // + 0: never -0
      side: bearingDeg > SIDE_DEG ? 'right' : bearingDeg < -SIDE_DEG ? 'left' : 'both',
    },
    distanceM,
    elevationDeg,
    bearingDeg,
  };
}
