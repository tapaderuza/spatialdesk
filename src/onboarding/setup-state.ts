/**
 * What the guided setup (src/onboarding/setup.ts) leaves behind, and who may ask for it. System-free, so the coach, the
 * agent's card and the room system can read it without importing the system itself.
 */
const CALIBRATED_KEY = 'spatialdesk.calibrated';
const SEAT_KEY = 'spatialdesk.seat';

/** Where the person sits: a desk, or a sofa or bed (a body lying back; Fit room then accepts a low surface). */
export type Seat = 'desk' | 'sofa';

/** True while the setup is on screen: the first-run coach waits for it. */
export const setupState = { active: false };

export function calibrated(): boolean {
  try {
    return localStorage.getItem(CALIBRATED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markCalibrated(): void {
  try {
    localStorage.setItem(CALIBRATED_KEY, '1');
  } catch {
    /* private mode: the setup may show again next visit */
  }
}

/** The seat chosen in the setup, or null when none was (the comfort profile alone decides then). */
export function seat(): Seat | null {
  try {
    const value = localStorage.getItem(SEAT_KEY);
    return value === 'desk' || value === 'sofa' ? value : null;
  } catch {
    return null;
  }
}

export function setSeat(value: Seat): void {
  try {
    localStorage.setItem(SEAT_KEY, value);
  } catch {
    /* private mode: it holds for this visit only through the setup's own state */
  }
}

const requests = new Set<() => void>();

/** The system listens here; "Recalibrate" (voice or the My setup card) asks. False when nothing is listening. */
export function onSetupRequested(listener: () => void): () => void {
  requests.add(listener);
  return () => {
    requests.delete(listener);
  };
}

export function requestSetup(): boolean {
  for (const listener of requests) listener();
  return requests.size > 0;
}
