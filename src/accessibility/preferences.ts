/** Explicit access preferences only; no transcript, diagnosis, inferred ability or health history. */
export interface AccessPreferences {
  dwellMs: number;
  readDwellMs: number;
  settleMs: number;
  tremorTolerance: boolean;
  /** Tremor mode: how much recent aim decides which control a press means (src/ui/aim.ts). */
  aimWindowMs: number;
  targetGraceMs: number;
  clickCooldownMs: number;
  cuesVolume: number;
  ambienceVolume: number;
  voiceVolume: number;
  speechRate: number;
  monoAudio: boolean;
  listenPauseMs: number;
  listenFinalPauseMs: number;
  listenMaxMs: number;
  switchEnabled: boolean;
  scanIntervalMs: number;
  reducedMotion: boolean;
  readingScale: number;
  captionSize: number;
  presentationMode: boolean;
}

export const DEFAULT_ACCESS_PREFERENCES: Readonly<AccessPreferences> = Object.freeze({
  dwellMs: 1000, readDwellMs: 1600, settleMs: 150,
  tremorTolerance: false, aimWindowMs: 450, targetGraceMs: 200, clickCooldownMs: 350,
  cuesVolume: 1, ambienceVolume: 1, voiceVolume: 1, speechRate: 1, monoAudio: false,
  listenPauseMs: 1600, listenFinalPauseMs: 1500, listenMaxMs: 20_000,
  switchEnabled: false, scanIntervalMs: 1500, reducedMotion: false, readingScale: 1, captionSize: 1, presentationMode: false,
});

const KEY = 'spatialdesk.access-preferences';
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type BooleanPreference = 'tremorTolerance' | 'monoAudio' | 'switchEnabled' | 'reducedMotion' | 'presentationMode';
const fractional = new Set<keyof AccessPreferences>(['cuesVolume', 'ambienceVolume', 'voiceVolume', 'speechRate', 'readingScale', 'captionSize']);
const ranges: Record<Exclude<keyof AccessPreferences, BooleanPreference>, readonly [number, number]> = {
  dwellMs: [400, 5000], readDwellMs: [600, 8000], settleMs: [0, 1500], aimWindowMs: [200, 1200], targetGraceMs: [0, 600], clickCooldownMs: [0, 1500],
  cuesVolume: [0, 1], ambienceVolume: [0, 1], voiceVolume: [0, 1], speechRate: [0.5, 2], listenPauseMs: [800, 6000], listenFinalPauseMs: [800, 6000], listenMaxMs: [10_000, 60_000],
  scanIntervalMs: [600, 6000], readingScale: [0.8, 1.6], captionSize: [0.8, 1.8],
};

export function validAccessPreference<K extends keyof AccessPreferences>(key: K, value: unknown): value is AccessPreferences[K] {
  if (key === 'tremorTolerance' || key === 'monoAudio' || key === 'switchEnabled' || key === 'reducedMotion' || key === 'presentationMode') return typeof value === 'boolean';
  const range = ranges[key as keyof typeof ranges];
  return !!range && typeof value === 'number' && Number.isFinite(value) && value >= range[0] && value <= range[1] &&
    (fractional.has(key) || Number.isInteger(value));
}

export function readAccessPreferences(storage?: StorageAccess): AccessPreferences {
  const clean = { ...DEFAULT_ACCESS_PREFERENCES };
  try {
    const raw: unknown = JSON.parse((storage ?? localStorage).getItem(KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
    for (const key of Object.keys(clean) as (keyof AccessPreferences)[]) {
      const value = (raw as Record<string, unknown>)[key];
      if (validAccessPreference(key, value)) Object.assign(clean, { [key]: value });
    }
  } catch { /* unavailable storage leaves the current defaults */ }
  // ?steady: a link that starts in tremor mode, for someone whose hands shake (and for judges to try it).
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('steady')) clean.tremorTolerance = true;
  // ?switch: a link that starts in one-switch mode (src/accessibility/switch-system.ts), set up by whoever helps.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('switch')) clean.switchEnabled = true;
  return clean;
}

export const accessPreferences: AccessPreferences = readAccessPreferences();
const listeners = new Set<(preferences: Readonly<AccessPreferences>) => void>();

/** False means the value was rejected. A storage failure keeps a valid change for this visit only. */
export function setAccessPreference<K extends keyof AccessPreferences>(key: K, value: AccessPreferences[K]): boolean {
  if (!validAccessPreference(key, value)) return false;
  accessPreferences[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(accessPreferences)); } catch { /* session-only setting */ }
  for (const listener of listeners) listener(accessPreferences);
  return true;
}

export function onAccessPreferences(listener: (preferences: Readonly<AccessPreferences>) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function resetAccessPreferences(): void {
  Object.assign(accessPreferences, DEFAULT_ACCESS_PREFERENCES);
  try { localStorage.removeItem(KEY); } catch { /* reset still applies for this visit */ }
  for (const listener of listeners) listener(accessPreferences);
}
