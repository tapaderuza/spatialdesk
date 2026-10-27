/** Scalar helpers keep the render loop allocation-free and the existing animation exact when motion is allowed. */
export function companionTime(time: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : time;
}

export function companionBounce(time: number, celebration: number, calling: boolean, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return celebration > 0 && celebration < 1
    ? Math.sin(Math.PI * celebration)
    : calling ? 0.3 * Math.max(0, Math.sin(time * 5)) : 0;
}

export function companionFlash(celebration: number, reducedMotion: boolean): number {
  return !reducedMotion && celebration > 0 && celebration < 1 ? 0.6 * (1 - celebration) : 0;
}
