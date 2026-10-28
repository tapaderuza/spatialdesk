/**
 * Who may ask the helper panel (src/assist/helper-system.ts) to open: the voice command, the button on the start screen.
 * System-free, like src/onboarding/setup-state.ts, so those can ask without importing the system.
 */

/** True while the helper panel is on screen: the guided setup a helper's call opens takes its place meanwhile. */
export const helperState = { open: false };

const requests = new Set<() => void>();

/** The system listens here. */
export function onInviteRequested(listener: () => void): () => void {
  requests.add(listener);
  return () => {
    requests.delete(listener);
  };
}

/** "Invite a helper": false when nothing is listening (the world is not up yet). */
export function requestInvite(): boolean {
  for (const listener of requests) listener();
  return requests.size > 0;
}
