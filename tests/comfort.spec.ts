/**
 * The space adapts to the body and the mind, through the agent (Accessibility, Agentic):
 *  - said in plain words ("I can't turn my neck and I only use my right hand"), the request goes to the agent as
 *    "comfort"; its set_comfort steps move every panel that sits in its place, the console to the hand that works,
 *    and one undo takes the whole adaptation back;
 *  - "Start small" asks for a first step of five minutes; when it ends, the agent is told the user has started, so it
 *    keeps the momentum instead of suggesting a break.
 * The agent's answers are mocked here; the server's planner tests check the real ones (server/app AgentTest).
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, frames, pressXR, type Win } from './helpers.js';

const session = (page: Page) => page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));

/** Each board's and the console's yaw from the user's anchor, in degrees (+ is left). */
const yaws = (page: Page) =>
  page.evaluate(() => {
    const ws = (window as Win).__workspace.state;
    const a = ws.anchor;
    const yaw = (p: { x: number; z: number }) => {
      let y = Math.atan2(-(p.x - a.x), -(p.z - a.z)) - a.yaw;
      while (y > Math.PI) y -= 2 * Math.PI;
      while (y < -Math.PI) y += 2 * Math.PI;
      return (y * 180) / Math.PI;
    };
    return { boards: ws.boards.map((b: any) => yaw(b.pose)) as number[], console: yaw((window as Win).__world.getSceneObject('command-panel').position) };
  });

test('comfort: said in plain words, everything gathers within reach on the right, and one undo takes it back', async ({ page }) => {
  await session(page);
  const asked: any[] = [];
  await page.route('**/api/agent/plan', async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        ok: true,
        summary: 'Everything is within reach, on your right. Say undo for any step.',
        steps: [
          { op: { op: 'set_comfort', turnDeg: 25 }, why: 'Within 25 degrees: no neck turn needed' },
          { op: { op: 'set_comfort', side: 'right' }, why: 'Everything on your right, where you work' },
        ],
        source: 'us.amazon.nova-2-lite-v1:0',
      },
    });
  });
  const errors = await enterXR(page, '&fast');
  const before = await yaws(page);
  expect(before.console).toBeGreaterThan(45); // the console on the left, as designed

  await page.evaluate(() => (window as Win).__voice.say("I can't turn my neck and I only use my right hand"));
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  expect(asked[0].intent).toBe('comfort');
  expect(asked[0].text).toContain('neck');
  await pressXR(page, 'agent:plan-apply');
  await frames(page, 5);

  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort)).toEqual({ reach: 1, scale: 1, side: 'right', turnDeg: 25, tiltDeg: 0 });
  const after = await yaws(page);
  const focus = await page.evaluate(() => (window as Win).__workspace.state.boards.findIndex((b: any) => b.id === (window as Win).__workspace.state.focusBoardId));
  expect(after.boards[focus]).toBeLessThan(0); // the board she works on leans to her right
  expect(after.console).toBeLessThan(-45); // the console by the right hand
  // Nothing beyond a 25-degree turn and the eyes' own reach (boards only glanced at may sit across the board).
  for (const yaw of [...after.boards, after.console]) expect(Math.abs(yaw)).toBeLessThanOrEqual(25 + 30 + 0.5);

  // One undo takes the whole adaptation back.
  await page.evaluate(() => (window as Win).__workspace.undo());
  await frames(page, 5);
  const back = await yaws(page);
  expect(back.console).toBeCloseTo(before.console, 3);
  expect(await page.evaluate(() => (window as Win).__agent.state.phase)).toBe('idle'); // the applied check-in is obsolete after Undo
  back.boards.forEach((yaw, i) => expect(yaw).toBeCloseTo(before.boards[i], 3));
  expect(errors).toEqual([]);
});

test('start small: five minutes on the first bit, and when they end the agent hears the user has started', async ({ page }) => {
  test.setTimeout(90_000);
  await session(page);
  const asked: any[] = [];
  await page.route('**/api/agent/plan', async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    if (body.intent !== 'first_step') return new Promise(() => {}); // the next block: the request itself is the check
    const doing = body.workspace.boards[0]?.columns[1]?.cards[0]?.title;
    await route.fulfill({
      json: {
        ok: true,
        summary: 'Start small: five minutes, then see how it feels.',
        steps: [{ op: { op: 'start_timer', minutes: 5, ...(doing ? { card: doing } : {}), label: 'First step: open it, do the smallest bit' }, why: 'Five minutes' }],
        source: 'built-in',
      },
    });
  });
  const errors = await enterXR(page, '&fast'); // ?fast: five minutes are five seconds
  await pressXR(page, 'command:start-button', 'left');
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  expect(asked[0].intent).toBe('first_step');
  await pressXR(page, 'agent:plan-apply');
  // One failure of this step was seen in a full-suite push. A lost press on a panel that had just changed its buttons was
  // reproduced since (8 in 25, tests/helpers.ts pressXR aimed at where the button was, not where it is) and fixed; if this
  // wait ever times out again, the message says what the agent was doing instead of a bare timeout.
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.some((t: any) => t.label.startsWith('First step')), null, { timeout: 15_000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({ phase: (window as Win).__agent.state.phase, error: (window as Win).__agent.state.plan?.error ?? null, timers: (window as Win).__workspace.state.timers.map((t: any) => t.label) }));
    throw new Error(`Apply did not start the First step timer: ${JSON.stringify(state)}\n${error.message}`);
  });

  await expect.poll(() => asked.length, { timeout: 20_000 }).toBe(2);
  expect(asked[1].intent).toBe('next_block');
  expect(asked[1].context).toMatch(/first step .* just finished: the user has started/);
  expect(errors).toEqual([]);
});
