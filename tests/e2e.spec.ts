/**
 * End-to-end smoke test: the WebXR app gets a session from the command server, opens the WebSocket, syncs
 * its clock (Kotlin ClockSync running in the browser) and keeps it while in XR.
 * Local: `npm run test:e2e` (starts the Spring Boot jar). Production: `E2E_URL=https://<cloudfront> npm run test:e2e`.
 */
import { expect, test } from '@playwright/test';

const target = process.env.E2E_URL;

test.use(target ? { baseURL: target } : {});

test('app connects to the command server and syncs its clock', async ({ page }) => {
  test.skip(!process.env.E2E && !target, 'end-to-end only (E2E=1 or E2E_URL)');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(target ? '/?emulate' : '/?emulate&perf');
  await page.waitForFunction(() => (window as any).__link?.kind === 'online', null, { timeout: 60_000 });
  await page.waitForFunction(() => (window as any).__link?.clockSynced === true, null, { timeout: 30_000 });
  const link = await page.evaluate(() => (window as any).__link);
  console.log('E2E LINK', JSON.stringify(link));

  expect(link.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(link.rttMs).toBeGreaterThanOrEqual(0);
  expect(link.rttMs).toBeLessThan(target ? 1500 : 200);
  expect(errors).toEqual([]);
});

/** Week 3 milestone: "Plan my day" turns a description into boards, cards and a timer in under 4 s (real Bedrock). */
test('plan my day: from the request to an applied plan in under 4 s', async ({ page }) => {
  test.skip(!process.env.E2E && !target, 'end-to-end only (E2E=1 or E2E_URL)');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__link?.kind === 'online' && (window as any).__agent, null, { timeout: 60_000 });

  await page.evaluate(() =>
    (window as any).__agent.run(
      'plan_my_day',
      'Finish the quarterly report, review two pull requests, call the dentist and prepare slides for Friday. Gym at 18:00.',
    ),
  );
  const plan = await page.evaluate(() => (window as any).__agent.state.plan);
  const ms = await page.evaluate(() => (window as any).__agent.timings.previewed - (window as any).__agent.timings.requested);
  console.log('E2E PLAN', JSON.stringify({ ms: Math.round(ms), source: plan?.source, latencyMs: plan?.latencyMs, attempts: plan?.attempts, steps: plan?.steps?.map((s: any) => s.op.op) }));
  expect(plan?.ok, plan?.error).toBe(true);
  expect(plan.source).toContain('nova'); // the AI answered, not the built-in fallback
  expect(ms).toBeLessThan(4000);

  await page.evaluate(() => (window as any).__agent.apply());
  const ws = await page.evaluate(() => (window as any).__workspace.state);
  const created = ws.boards.filter((b: any) => !['Getting started', 'Ideas'].includes(b.title));
  expect(created.length).toBeGreaterThanOrEqual(1);
  expect(created.flatMap((b: any) => b.columns.flatMap((c: any) => c.cards)).length).toBeGreaterThanOrEqual(4);
  expect(ws.timers.length).toBeGreaterThanOrEqual(1);
  expect(ws.focusBoardId).toBe(created[0].id); // the new board is the one within reach
  expect(errors).toEqual([]);
});
