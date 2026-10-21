/**
 * A reason to come back (special award "Best Reason to Come Back"): progress between sessions. The day-by-day rules as
 * pure functions (visits, streaks that survive the morning, the seven-day strip, cards done), then in the browser:
 * yesterday's progress shows on the command panel, the agent offers to plan today from what is still open, and a
 * finished focus block extends the streak.
 */
import { expect, test } from '@playwright/test';
import { dayStartNudge } from '../src/agent/watcher.js';
import type { Workspace } from '../src/workspace/model.js';
import { dayKey, Progress } from '../src/workspace/progress.js';
import { openWorkspace, tap, type Win } from './helpers.js';

const DAY = 86_400_000;
const NOON = new Date(2026, 9, 21, 12, 0, 0).getTime(); // Wednesday 21 Oct 2026, local noon

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const board = (columns: string[][]): Workspace =>
  ({
    boards: [{ id: 'b1', title: 'Today', columns: columns.map((cards, c) => ({ id: `c${c}`, title: ['To do', 'Doing', 'Done'][c], cards: cards.map((t, k) => ({ id: `k${c}${k}`, title: t, priority: 'normal' })) })) }],
    timers: [],
  }) as unknown as Workspace;

test('progress: visits, a streak that survives the morning, the week strip, cards done', () => {
  const storage = memory();
  expect(new Progress(storage, NOON - 2 * DAY).previousVisit).toBeNull(); // first visit
  const monday = new Progress(storage, NOON - 2 * DAY);
  expect(monday.previousVisit).toBeNull(); // the same day again
  monday.recordBlock(25, NOON - 2 * DAY);

  const tuesday = new Progress(storage, NOON - DAY);
  expect(tuesday.previousVisit).toBe(dayKey(NOON - 2 * DAY));
  tuesday.recordBlock(25, NOON - DAY);
  tuesday.recordBlock(50, NOON - DAY);
  tuesday.recordDone(3, NOON - DAY);

  const wednesday = new Progress(storage, NOON);
  expect(wednesday.previousVisit).toBe(dayKey(NOON - DAY));
  expect(wednesday.day(dayKey(NOON - DAY))).toEqual({ blocks: 2, minutes: 75, done: 3 });
  expect(wednesday.streak(NOON)).toBe(2); // no block yet today: yesterday's streak still counts
  expect(wednesday.summary(NOON)).toBe('No focus block yet today. 2-day streak: one block keeps it going.');
  expect(wednesday.week(NOON)).toEqual([false, false, false, false, true, true, false]);
  wednesday.recordBlock(25, NOON);
  expect(wednesday.streak(NOON)).toBe(3);
  expect(wednesday.summary(NOON)).toBe('Today: 1 focus block, 25 min, 0 done. 3-day streak.');
  expect(new Progress(storage, NOON + 2 * DAY).streak(NOON + 2 * DAY)).toBe(0); // a day missed: it starts again

  const before = board([['A', 'B'], ['C'], []]);
  const after = board([['A'], [], ['C', 'B']]);
  expect(Progress.newlyDone(before, after)).toBe(2);
  expect(Progress.newlyDone(after, after)).toBe(0);
});

test('start of day: the agent offers to plan today from what is still open, never on a first visit', () => {
  const ws = board([['Call the dentist', 'Book flights'], ['Finish the quarterly report'], ['Old done card']]);
  const last = { blocks: 2, minutes: 75, done: 3 };
  expect(dayStartNudge(ws, null, last, NOON)).toBeNull();
  expect(dayStartNudge(board([[], [], ['x']]), dayKey(NOON - DAY), last, NOON)).toBeNull(); // nothing open

  const nudge = dayStartNudge(ws, dayKey(NOON - DAY), last, NOON)!;
  expect(nudge.text).toBe('Welcome back. 3 tasks are still open from yesterday. Tap to plan today.');
  expect(nudge.intent).toBe('plan_my_day');
  expect(nudge.context).toContain('"Finish the quarterly report" (in progress), "Call the dentist"');
  expect(nudge.context.length).toBeLessThanOrEqual(300); // what the server keeps
  expect(dayStartNudge(ws, dayKey(NOON - 5 * DAY), last, NOON)!.text).toContain('from your last visit');
});

test('progress in the browser: yesterday on the command panel, the start-of-day plan, and a block that extends the streak', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return; // only the first load is "the next day"
    sessionStorage.setItem('seeded', '1');
    const key = (n: number) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    localStorage.setItem('spatialdesk.progress', JSON.stringify({ days: { [key(1)]: { blocks: 2, minutes: 75, done: 3 }, [key(2)]: { blocks: 1, minutes: 25, done: 1 } }, lastVisit: key(1) }));
  });
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  let context: string | undefined;
  await page.route('**/api/agent/plan', async (route) => {
    context = route.request().postDataJSON().context;
    await route.fulfill({ json: { ok: true, summary: 'Today, from yesterday.', steps: [], source: 'us.amazon.nova-2-lite-v1:0' } });
  });
  const errors = await openWorkspace(page);
  const read = (name: string, key: string) =>
    page.evaluate(
      ({ name, key }) => {
        let value: unknown;
        (window as Win).__world.scene.traverse((o: any) => {
          if (o.name === name) value = o.properties.value[key];
        });
        return value;
      },
      { name, key },
    );

  await page.waitForFunction(() => (window as Win).__agent.state.nudge?.key === 'day-start', null, { timeout: 10_000 });
  expect(await page.evaluate(() => (window as Win).__agent.state.nudge.text)).toMatch(/^Welcome back\. \d+ tasks are still open from yesterday/);
  expect(await read('command:day-5', 'backgroundColor')).toBe('#5ee0a0'); // yesterday
  expect(await read('command:day-4', 'backgroundColor')).toBe('#5ee0a0');
  expect(await read('command:day-6', 'backgroundColor')).toBe('#2a313b'); // today, not yet

  await tap(page, 'command:notice'); // take the nudge to the agent
  await page.waitForFunction(() => !['thinking', 'idle'].includes((window as Win).__agent.state.phase), null, { timeout: 10_000 });
  expect(context).toContain('A new day');

  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'start_timer', minutes: 0.1, label: 'Report' })); // 6 s
  await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('spatialdesk.progress') ?? '{"days":{}}').days).length === 3, null, { timeout: 15_000 });
  await page.waitForTimeout(200);
  expect(await read('command:day-6', 'backgroundColor')).toBe('#5ee0a0');
  expect(errors).toEqual([]);
});
