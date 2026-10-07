/**
 * What the agent notices on its own, from the workspace and the clock. Pure functions, checked every 30 s (not per
 * frame): work running over its estimate, a timed task coming up, boards left nearly empty, and the end of a timer.
 * Each becomes a nudge the user can take to the agent with one tap; the agent never acts without that tap.
 */
import type { Timer, Workspace } from '../workspace/model.js';
import type { Intent } from './client.js';

export interface Nudge {
  /** Once shown, a key is not shown again (keys for running over change every 30 minutes). */
  key: string;
  text: string;
  intent: Intent;
  context: string;
}

const MINUTE = 60_000;
const TIME_IN_TITLE = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/;

export function findNudge(ws: Workspace, now: number, seen: ReadonlySet<string>, runningSinceMs: number): Nudge | null {
  for (const board of ws.boards) {
    // Columns between the first and the last are "in progress".
    for (const column of board.columns.slice(1, -1)) {
      for (const card of column.cards) {
        if (!card.minutes || card.since == null) continue;
        const elapsed = Math.round((now - card.since) / MINUTE);
        if (elapsed <= card.minutes * 1.25 + 5) continue;
        const key = `over:${card.id}:${Math.floor(elapsed / 30)}`;
        if (seen.has(key)) continue;
        return {
          key,
          text: `"${card.title}" is running over (${elapsed} of ${card.minutes} min). Tap to re-plan.`,
          intent: 'replan',
          context: `"${card.title}" is running over: ${elapsed} min in progress, estimate ${card.minutes} min.`,
        };
      }
    }
  }
  for (const board of ws.boards) {
    for (const column of board.columns.slice(0, -1)) {
      for (const card of column.cards) {
        const match = TIME_IN_TITLE.exec(card.title);
        if (!match) continue;
        const at = new Date(now);
        at.setHours(Number(match[1]), Number(match[2]), 0, 0);
        const minutes = Math.round((at.getTime() - now) / MINUTE);
        if (minutes <= 0 || minutes > 15) continue;
        const key = `soon:${card.id}`;
        if (seen.has(key)) continue;
        return {
          key,
          text: `"${card.title}" is in ${minutes} min. Tap to plan around it.`,
          intent: 'replan',
          context: `"${card.title}" is coming up in ${minutes} minutes.`,
        };
      }
    }
  }
  if (ws.boards.length >= 3 && now - runningSinceMs > 2 * MINUTE && !seen.has('regroup')) {
    const open = ws.boards.map((b) => ({ title: b.title, cards: b.columns.slice(0, -1).reduce((n, c) => n + c.cards.length, 0) }));
    if (Math.min(...open.map((b) => b.cards)) <= 1) {
      return {
        key: 'regroup',
        text: 'Some boards are nearly empty. Tap to let the AI regroup them.',
        intent: 'regroup',
        context: `Open cards per board: ${open.map((b) => `"${b.title}" ${b.cards}`).join(', ')}.`,
      };
    }
  }
  return null;
}

/** When a timer rings: after a break, back to focus; after a focus block, the next block. */
export function timerContext(timer: Timer, ws: Workspace): { intent: Intent; context: string } {
  const minutes = Math.round(timer.durationMs / MINUTE);
  if (/^break$/i.test(timer.label.trim())) return { intent: 'focus', context: `The ${minutes}-minute break just finished.` };
  let title = timer.label;
  for (const board of ws.boards) for (const column of board.columns) for (const card of column.cards) if (card.id === timer.cardId) title = card.title;
  return { intent: 'next_block', context: `The ${minutes}-minute focus timer on "${title}" just finished.` };
}
