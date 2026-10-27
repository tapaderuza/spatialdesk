import type { Comfort, Workspace } from '../workspace/model.js';

/** An explicitly saved setup, containing settings only: no transcripts or health notes. */
export interface ComfortMemory {
  version: 1;
  savedAt: number;
  comfort: Workspace['comfort'];
}

const KEY = 'spatialdesk.comfort-memory';
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const fields = ['reach', 'scale', 'turnDeg', 'tiltDeg'] as const;
const ranges = [[0.5, 1.8], [0.8, 1.8], [20, 120], [-25, 30]] as const;

function settings(value: unknown): Comfort | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Comfort;
  if (!['both', 'left', 'right'].includes(c.side)) return null;
  if (fields.some((key, i) => typeof c[key] !== 'number' || !Number.isFinite(c[key]) || c[key] < ranges[i][0] || c[key] > ranges[i][1])) return null;
  return { reach: c.reach, scale: c.scale, side: c.side, turnDeg: c.turnDeg, tiltDeg: c.tiltDeg };
}

export function readComfortMemory(storage?: StorageAccess): ComfortMemory | null {
  try {
    const data = JSON.parse((storage ?? localStorage).getItem(KEY) ?? 'null') as ComfortMemory | null;
    const comfort = settings(data?.comfort);
    return data?.version === 1 && Number.isFinite(data.savedAt) && comfort ? { version: 1, savedAt: data.savedAt, comfort } : null;
  } catch { return null; }
}

export function saveComfortMemory(comfort: Comfort, storage?: StorageAccess): boolean {
  const clean = settings(comfort);
  if (!clean) return false;
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify({ version: 1, savedAt: Date.now(), comfort: clean }));
    return true;
  } catch { return false; }
}

export function forgetComfortMemory(storage?: StorageAccess): boolean {
  try { (storage ?? localStorage).removeItem(KEY); return true; } catch { return false; }
}
