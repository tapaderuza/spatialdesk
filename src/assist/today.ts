/**
 * What a helper may see: the titles of the cards on the Today board and the column each is in. Nothing else leaves the
 * headset (no notes, timers or comfort profile), and only after the owner has allowed it. Pure, so it can be tested alone.
 */
import type { Board, Workspace } from '../workspace/model.js';
import type { SharedTask } from './api.js';

/** The server accepts at most this many (AssistLimits.MAX_TASKS), each title up to 160 characters, column 80, id 100. */
export const MAX_SHARED_TASKS = 12;
const TITLE_MAX = 160;
const COLUMN_MAX = 80;
const ID_MAX = 100;

/** The board the helper follows: the one named Today (or Hoy), else the board being worked on, else the first. */
export function todayBoard(workspace: Workspace): Board | null {
  const named = workspace.boards.find((board) => /^\s*(today|hoy)\b/i.test(board.title));
  return named ?? workspace.boards.find((board) => board.id === workspace.focusBoardId) ?? workspace.boards[0] ?? null;
}

/** Control characters out, runs of spaces folded, trimmed, cut to length: what the server accepts. Null when nothing is left. */
function clean(text: string, max: number): string | null {
  const value = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return value || null;
}

export interface TodaySnapshot {
  tasks: SharedTask[];
  /** Cards on the board, shared or not (the server takes only [MAX_SHARED_TASKS]). */
  total: number;
}

/**
 * The cards to show, in board order. With more than the server takes, what is still to do comes first and the cards in the
 * last column (Done) fill what is left: a helper wants to know what is in progress more than what is finished.
 */
export function todayTasks(workspace: Workspace): TodaySnapshot {
  const board = todayBoard(workspace);
  if (!board) return { tasks: [], total: 0 };
  const lastColumn = board.columns.length - 1;
  const entries: { task: SharedTask; order: number; done: boolean }[] = [];
  board.columns.forEach((column, columnIndex) => {
    const columnTitle = clean(column.title, COLUMN_MAX);
    if (!columnTitle) return;
    for (const card of column.cards) {
      const title = clean(card.title, TITLE_MAX);
      const id = clean(card.id, ID_MAX);
      if (title && id) entries.push({ task: { id, title, column: columnTitle }, order: entries.length, done: lastColumn > 0 && columnIndex === lastColumn });
    }
  });
  const chosen = [...entries.filter((entry) => !entry.done), ...entries.filter((entry) => entry.done)].slice(0, MAX_SHARED_TASKS);
  chosen.sort((a, b) => a.order - b.order);
  return { tasks: chosen.map((entry) => entry.task), total: entries.length };
}
