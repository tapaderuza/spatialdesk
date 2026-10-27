import type { Comfort, Op } from '../workspace/model.js';

export const CALIBRATION_STEPS = ['reach', 'scale', 'side', 'turnDeg', 'tiltDeg', 'review'] as const;
export type CalibrationField = Exclude<typeof CALIBRATION_STEPS[number], 'review'>;
export const CALIBRATION_LIMITS = Object.freeze({ reach: [0.5, 1.8], scale: [0.8, 1.8], turnDeg: [20, 120], tiltDeg: [-25, 30] } as const);

export interface Calibration {
  readonly original: Readonly<Comfort>;
  readonly draft: Readonly<Comfort>;
  readonly step: number;
}

/** These bounds mirror the shared workspace engine; they are not clinical measurements or recommendations. */
function validComfort(c: Comfort): boolean {
  if (!['both', 'left', 'right'].includes(c.side)) return false;
  for (const field of ['reach', 'scale', 'turnDeg', 'tiltDeg'] as const) {
    const value = c[field], [low, high] = CALIBRATION_LIMITS[field];
    if (!Number.isFinite(value) || value < low || value > high) return false;
  }
  return true;
}

function snapshot(c: Comfort): Readonly<Comfort> {
  return Object.freeze({ reach: c.reach, scale: c.scale, side: c.side, turnDeg: c.turnDeg, tiltDeg: c.tiltDeg });
}

/** Starts a proposal without changing the workspace or saving a setup. */
export function beginCalibration(current: Comfort): Calibration {
  if (!validComfort(current)) throw new RangeError('The current comfort settings are outside workspace bounds.');
  return { original: snapshot(current), draft: snapshot(current), step: 0 };
}

export function calibrationField(calibration: Calibration): typeof CALIBRATION_STEPS[number] {
  return CALIBRATION_STEPS[calibration.step] ?? 'review';
}

export function setCalibrationValue<K extends CalibrationField>(calibration: Calibration, field: K, value: Comfort[K]): Calibration | null {
  if (!['reach', 'scale', 'side', 'turnDeg', 'tiltDeg'].includes(field)) return null;
  const draft: Comfort = { ...calibration.draft, [field]: value };
  if (!validComfort(draft)) return null;
  return { ...calibration, draft: snapshot(draft) };
}

export function nextCalibration(calibration: Calibration): Calibration {
  return { ...calibration, step: Math.min(CALIBRATION_STEPS.length - 1, calibration.step + 1) };
}

export function previousCalibration(calibration: Calibration): Calibration {
  return { ...calibration, step: Math.max(0, calibration.step - 1) };
}

/** Restores the proposal to the state from which this calibration started; it does not apply a change. */
export function restoreCalibration(calibration: Calibration): Calibration {
  return { original: calibration.original, draft: snapshot(calibration.original), step: 0 };
}

/** One field per operation keeps every accepted adjustment individually explainable and undoable. */
export function calibrationOps(calibration: Calibration): Op[] {
  if (!validComfort(calibration.original) || !validComfort(calibration.draft)) throw new RangeError('The proposed settings are outside workspace bounds.');
  const ops: Op[] = [];
  for (const field of ['reach', 'scale', 'side', 'turnDeg', 'tiltDeg'] as const) {
    if (calibration.original[field] !== calibration.draft[field]) ops.push({ op: 'set_comfort', [field]: calibration.draft[field] });
  }
  return ops;
}
