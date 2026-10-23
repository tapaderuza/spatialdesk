/**
 * What the agent notices on its own, from the workspace and the clock. Pure functions, checked every 30 s (not per
 * frame): work running over its estimate, a timed task coming up, boards left nearly empty, and the end of a timer.
 * Each becomes a nudge the user can take to the agent with one tap; the agent never acts without that tap.
 */
import type { Timer, Workspace } from '../workspace/model.js';
import { dayKey, type Day } from '../workspace/progress.js';
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

/**
 * Back on a new day with work still open: the agent offers to plan today from it, in-progress cards first. Never on a
 * first visit, nor on a second visit the same day ([previousVisit] is null then). [last] is that visit's progress.
 */
export function dayStartNudge(ws: Workspace, previousVisit: string | null, last: Day, now: number, wrapUp: string | null = null): Nudge | null {
  if (!previousVisit) return null;
  const inProgress: string[] = [];
  const open: string[] = [];
  for (const board of ws.boards) {
    board.columns.slice(0, -1).forEach((column, c) => column.cards.forEach((card) => (c > 0 ? inProgress : open).push(card.title)));
  }
  const total = inProgress.length + open.length;
  if (total === 0) return null;
  const when = dayKey(now - 86_400_000) === previousVisit ? 'yesterday' : 'your last visit';
  const short = (title: string) => `"${title.length > 36 ? `${title.slice(0, 33)}...` : title}"`;
  // The server keeps 300 characters of context: the in-progress cards and a few open ones fit.
  const named = [...inProgress.map((t) => `${short(t)} (in progress)`), ...open.map(short)].slice(0, 4).join(', ');
  return {
    key: 'day-start',
    text: `Welcome back. ${total} ${total === 1 ? 'task is' : 'tasks are'} still open from ${when}. Tap to plan today.`,
    intent: 'plan_my_day',
    // The day ended with a wrap-up: its words lead, so the plan picks up where the user left off.
    context: wrapUp
      ? `A new day. Last visit (${previousVisit}) ended with: ${wrapUp.slice(0, 110)} Still open: ${named}.`
      : `A new day; last visit ${previousVisit}: ${last.blocks} focus blocks, ${last.done} cards done. Still open: ${named}.`,
  };
}

/** From this hour on, a day with focus blocks may be wrapped up (local time). */
const WIND_DOWN_HOUR = 17;

/**
 * The end of a working day: after WIND_DOWN_HOUR, with at least one focus block today and the day not wrapped up yet,
 * the agent offers to wrap it up: what got done is named and cleared away, and tomorrow's first task goes on top.
 */
export function dayEndNudge(ws: Workspace, today: Day, now: number, wrappedUp: boolean): Nudge | null {
  if (wrappedUp || today.blocks === 0 || new Date(now).getHours() < WIND_DOWN_HOUR) return null;
  return {
    key: `day-end:${dayKey(now)}`,
    text: `Good work today: ${today.blocks} focus block${today.blocks === 1 ? '' : 's'}. Tap to wrap up your day.`,
    intent: 'wrap_up',
    context: wrapUpContext(ws, today),
  };
}

/** What the agent needs to wrap up the day: today's blocks and minutes, and what sits in the last columns now. */
export function wrapUpContext(ws: Workspace, today: Day): string {
  const done = ws.boards.flatMap((b) => (b.columns.length > 1 ? b.columns[b.columns.length - 1].cards.map((c) => `"${c.title.slice(0, 30)}"`) : []));
  const named = done.length ? ` Finished, in the last columns: ${done.slice(0, 4).join(', ')}${done.length > 4 ? ' and more' : ''}.` : '';
  return `The user is wrapping up the day. Today: ${today.blocks} focus blocks, ${today.minutes} min, ${today.done} cards done.${named}`;
}

/** When a timer rings: after a break, back to focus; after a focus block, the next block. */
export function timerContext(timer: Timer, ws: Workspace): { intent: Intent; context: string } {
  const minutes = Math.round(timer.durationMs / MINUTE);
  if (/^break$/i.test(timer.label.trim())) return { intent: 'focus', context: `The ${minutes}-minute break just finished.` };
  let title = timer.label;
  for (const board of ws.boards) for (const column of board.columns) for (const card of column.cards) if (card.id === timer.cardId) title = card.title;
  // After a first step the user has started: the agent keeps the momentum instead of suggesting a break.
  if (/^(?:first step|primer paso)/i.test(timer.label.trim())) {
    return { intent: 'next_block', context: `The ${minutes}-minute first step "${timer.label}" on "${title}" just finished: the user has started.` };
  }
  return { intent: 'next_block', context: `The ${minutes}-minute focus timer on "${title}" just finished.` };
}
