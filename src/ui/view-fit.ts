/**
 * The comfortable part of the headset's view, measured from the headset itself, never looked up per device. Each
 * eye's projection matrix gives the angles the runtime renders: on Meta VR Glasses 37 degrees either side, 25 up and
 * 43 down. Meta puts the glasses' p90 perceived field of view at 58 x 54 degrees of that 74 x 68 degree render extent;
 * the same share of whatever a headset renders is taken as the comfortable view for essential content, and the layout
 * fits into it (Layout.kt). Both eyes count: across, only what both of them see.
 * Called once when a session starts, never per frame.
 */
import type { ViewFit } from '../workspace/model.js';

/** Meta's perceived field of view on Meta VR Glasses as a share of their render extent, across and vertically. */
const PERCEIVED_SHARE = { across: 58 / 74, vertical: 54 / 68 } as const;
/** Views closer than this (degrees) are the same view: a rounding difference never refits the layout. */
const SAME_DEG = 1;

/** Render extent in degrees from straight ahead. */
export interface Extent {
  left: number;
  right: number;
  up: number;
  down: number;
}

let emulated: Extent | null = null;

/**
 * The emulator masks the glasses' narrower view over an ordinary projection (IWER's view mask, sampled from the
 * glasses' own projection matrices), so it hands over that extent instead (src/emulator.ts).
 */
export function emulateRenderExtent(extent: Extent): void {
  emulated = extent;
}

/** The comfortable view for this frame's viewer, or null before the headset reports one. */
export function measureView(frame: XRFrame | null | undefined, space: XRReferenceSpace | null | undefined): ViewFit | null {
  const extent = emulated ?? (frame && space ? projectionExtent(frame, space) : null);
  if (!extent) return null;
  return {
    halfWidthDeg: round(Math.min(extent.left, extent.right) * PERCEIVED_SHARE.across),
    upDeg: round(extent.up * PERCEIVED_SHARE.vertical),
    downDeg: round(extent.down * PERCEIVED_SHARE.vertical),
  };
}

export function sameView(a: ViewFit | undefined, b: ViewFit): boolean {
  return (
    a != null &&
    Math.abs(a.halfWidthDeg - b.halfWidthDeg) < SAME_DEG &&
    Math.abs(a.upDeg - b.upDeg) < SAME_DEG &&
    Math.abs(a.downDeg - b.downDeg) < SAME_DEG
  );
}

/**
 * The angles each view's perspective projection covers, keeping the narrowest per side over both eyes. A WebXR
 * projection matrix (column-major) has m[0] = 2n/(r-l), m[8] = (r+l)/(r-l), m[5] = 2n/(t-b), m[9] = (t+b)/(t-b),
 * so tan(left) = (1 - m[8]) / m[0], tan(right) = (1 + m[8]) / m[0], and likewise up and down with m[5] and m[9].
 */
function projectionExtent(frame: XRFrame, space: XRReferenceSpace): Extent | null {
  const pose = frame.getViewerPose(space);
  if (!pose || pose.views.length === 0) return null;
  const extent: Extent = { left: 90, right: 90, up: 90, down: 90 };
  for (const view of pose.views) {
    const m = view.projectionMatrix;
    if (!(m[0] > 0 && m[5] > 0)) return null;
    extent.left = Math.min(extent.left, degrees(Math.atan((1 - m[8]) / m[0])));
    extent.right = Math.min(extent.right, degrees(Math.atan((1 + m[8]) / m[0])));
    extent.up = Math.min(extent.up, degrees(Math.atan((1 + m[9]) / m[5])));
    extent.down = Math.min(extent.down, degrees(Math.atan((1 - m[9]) / m[5])));
  }
  return extent;
}

const degrees = (radians: number) => (radians * 180) / Math.PI;
const round = (deg: number) => Math.round(deg * 10) / 10;
