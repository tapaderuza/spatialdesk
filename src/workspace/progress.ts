/**
 * Progress between sessions, kept in this browser: focus blocks finished, minutes focused and cards done, day by day.
 * It gives the command panel its "today" line and seven-day strip, and the agent its start-of-day context: a reason to
 * come back tomorrow that is about the user's own work, not points. Pure (storage is passed in), so the rules are
 * tested without a browser; src/panel.ts feeds it.
 */
import type { Workspace } from './model.js';

export interface Day {
  blocks: number;
  minutes: number;
  done: number;
}

interface Saved {
  days: Record<string, Day>;
  lastVisit?: string;
}

const KEY = 'spatialdesk.progress';
const KEEP_DAYS = 60;
const DAY_MS = 86_400_000;

/** The local calendar day, "2026-10-21". */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The same local day [n] days earlier (by calendar, so a daylight-saving change never skips a day). */
function daysBefore(ms: number, n: number): string {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return dayKey(d.getTime());
}

export class Progress {
  private readonly saved: Saved;
  /** The last day before today this browser opened the workspace, or null on a first visit. */
  readonly previousVisit: string | null;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null,
    now = Date.now(),
  ) {
    let saved: Saved = { days: {} };
    try {
      const parsed = JSON.parse(storage?.getItem(KEY) ?? 'null') as Saved | null;
      if (parsed && typeof parsed.days === 'object') saved = parsed;
    } catch {
      // unreadable: start counting again
    }
    this.saved = saved;
    const today = dayKey(now);
    this.previousVisit = saved.lastVisit && saved.lastVisit !== today ? saved.lastVisit : null;
    saved.lastVisit = today;
    this.save(now);
  }

  day(key: string): Day {
    return this.saved.days[key] ?? { blocks: 0, minutes: 0, done: 0 };
  }

  today(now = Date.now()): Day {
    return this.day(dayKey(now));
  }

  /** Days in a row with a focus block, ending today, or yesterday while today has none yet (it is not lost at 9 am). */
  streak(now = Date.now()): number {
    let n = this.today(now).blocks > 0 ? 0 : 1;
    let count = 0;
    while (this.day(daysBefore(now, n)).blocks > 0) {
      count++;
      n++;
    }
    return count;
  }

  /** The last seven days, oldest first: true when the day had a focus block. */
  week(now = Date.now()): boolean[] {
    return Array.from({ length: 7 }, (_, i) => this.day(daysBefore(now, 6 - i)).blocks > 0);
  }

  recordBlock(minutes: number, now = Date.now()): void {
    const day = this.edit(now);
    day.blocks++;
    day.minutes += Math.max(0, Math.round(minutes));
    this.save(now);
  }

  recordDone(cards: number, now = Date.now()): void {
    if (cards <= 0) return;
    this.edit(now).done += cards;
    this.save(now);
  }

  /** "Today: 2 focus blocks, 50 min, 3 done. 4-day streak." */
  summary(now = Date.now()): string {
    const today = this.today(now);
    const streak = this.streak(now);
    const days = streak > 0 ? ` ${streak}-day streak${today.blocks === 0 ? ': one block keeps it going' : ''}.` : '';
    if (today.blocks === 0 && today.done === 0) return streak > 0 ? `No focus block yet today.${days}` : 'Finish a focus block to start a streak.';
    const blocks = `${today.blocks} focus block${today.blocks === 1 ? '' : 's'}${today.minutes ? `, ${today.minutes} min` : ''}`;
    return `Today: ${blocks}, ${today.done} done.${days}`;
  }

  /** How many cards a change put into a board's last column ("Done") that were not in one before. */
  static newlyDone(before: Workspace, after: Workspace): number {
    const done = (ws: Workspace) => new Set(ws.boards.flatMap((b) => b.columns[b.columns.length - 1]?.cards.map((c) => c.id) ?? []));
    const was = done(before);
    let count = 0;
    for (const id of done(after)) if (!was.has(id)) count++;
    return count;
  }

  private edit(now: number): Day {
    const key = dayKey(now);
    this.saved.days[key] ??= { blocks: 0, minutes: 0, done: 0 };
    return this.saved.days[key];
  }

  private save(now: number): void {
    const oldest = now - KEEP_DAYS * DAY_MS;
    for (const key of Object.keys(this.saved.days)) if (new Date(`${key}T12:00:00`).getTime() < oldest) delete this.saved.days[key];
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.saved));
    } catch {
      // private mode or full: progress lasts for this visit only
    }
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage blocked: progress lasts for this visit only
  }
}

/** This browser's progress. Created when the app loads: that load is today's visit. */
export const progress = new Progress(browserStorage());
