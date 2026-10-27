import type { Board, Card, Timer, Workspace } from '../workspace/model.js';

/** A work checkpoint the user chooses to save, separate from the conversation and energy choice. */
export interface ResumeNote {
  version: 1;
  savedAt: number;
  boardId: string;
  cardId: string;
  nextStep: string;
  timerId?: string;
}

type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = 'spatialdesk.resume-note';
const MAX_NOTE = 180;

export interface OpenTask { board: Board; card: Card }
export type ResumeContext = { status: 'missing' | 'done' } | { status: 'ready'; task: OpenTask; timer?: Timer };

function clean(value: unknown): ResumeNote | null {
  if (!value || typeof value !== 'object') return null;
  const n = value as ResumeNote;
  if (n.version !== 1 || !Number.isFinite(n.savedAt) || n.savedAt <= 0) return null;
  if ([n.boardId, n.cardId].some(id => typeof id !== 'string' || !id.trim() || id.length > 100)) return null;
  if (typeof n.nextStep !== 'string' || n.nextStep.length > MAX_NOTE || /[\x00-\x1f\x7f]/.test(n.nextStep)) return null;
  if (n.timerId !== undefined && (typeof n.timerId !== 'string' || !n.timerId || n.timerId.length > 100)) return null;
  return { version: 1, savedAt: n.savedAt, boardId: n.boardId, cardId: n.cardId, nextStep: n.nextStep.trim(), ...(n.timerId ? { timerId: n.timerId } : {}) };
}

export function readResumeNote(storage?: StorageAccess): ResumeNote | null {
  try { return clean(JSON.parse((storage ?? localStorage).getItem(KEY) ?? 'null')); } catch { return null; }
}

export function saveResumeNote(note: Omit<ResumeNote, 'version' | 'savedAt'>, storage?: StorageAccess): boolean {
  const value = clean({ ...note, version: 1, savedAt: Date.now() });
  if (!value) return false;
  try { (storage ?? localStorage).setItem(KEY, JSON.stringify(value)); return true; } catch { return false; }
}

export function forgetResumeNote(storage?: StorageAccess): boolean {
  try { (storage ?? localStorage).removeItem(KEY); return true; } catch { return false; }
}

/** Current titles are read from the workspace. A finished/deleted card is never recreated. */
export function resumeContext(note: ResumeNote, ws: Workspace): ResumeContext {
  for (const board of ws.boards) for (let i = 0; i < board.columns.length; i++) {
    const card = board.columns[i].cards.find(c => c.id === note.cardId);
    if (!card) continue;
    if (i === board.columns.length - 1) return { status: 'done' };
    const timer = ws.timers.find(t => t.id === note.timerId && (!t.cardId || t.cardId === card.id));
    return { status: 'ready', task: { board, card }, timer };
  }
  return { status: 'missing' };
}

/** Prefer the actual running task, then work in progress on the current board. */
export function returnTasks(ws: Workspace): OpenTask[] {
  const tasks: OpenTask[] = [];
  for (const board of ws.boards) {
    for (const column of board.columns.length > 1 ? [...board.columns.slice(1, -1), board.columns[0]] : []) {
      for (const card of column.cards) tasks.push({ board, card });
    }
  }
  const active = ws.timers.find(t => t.state === 'running' && t.cardId)?.cardId;
  return tasks.sort((a, b) => Number(b.card.id === active) - Number(a.card.id === active) || Number(b.board.id === ws.focusBoardId) - Number(a.board.id === ws.focusBoardId));
}

/** Kept verbatim (apart from whitespace) and bounded: notes are user-authored, not AI summaries. */
export function nextStepText(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
}
