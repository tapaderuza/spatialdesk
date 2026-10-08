/**
 * Week 5 gates, with real pointer events on the production build: the guided start takes under a minute, high
 * contrast really changes what is drawn (and is remembered), and a spent quota or an unreachable server is explained
 * on the card instead of breaking anything.
 */
import { expect, test } from '@playwright/test';
import { openWorkspace, tap, type Win } from './helpers.js';

test('first five minutes: the guided start takes under a minute, hands only', async ({ page }) => {
  const errors = await openWorkspace(page);
  await page.waitForFunction(() => {
    let shown = false;
    (window as Win).__world.scene.traverse((o: any) => {
      if (o.name === 'coach:coach-text' && o.isVisible?.value) shown = true;
    });
    return shown;
  });
  await tap(page, 'b1:card-0-0'); // 1 of 3: pick a card
  await page.waitForTimeout(400);
  await tap(page, 'b1:col-1', 0, -0.4); // 2 of 3: drop it in Doing
  await page.waitForTimeout(400);
  await tap(page, 'command:focus-button'); // 3 of 3: Focus 25
  await page.waitForFunction(() => (window as Win).__onboarding.done === true, null, { timeout: 5_000 });
  const done = await page.evaluate(() => (window as Win).__onboarding);
  console.log(`onboarding ${done.ms} ms`);
  expect(done.skipped).toBe(false);
  expect(done.ms).toBeLessThan(60_000);
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.length)).toBe(1);
  await page.reload();
  errors.push(...(await openWorkspace(page)));
  expect(await page.evaluate(() => (window as Win).__onboarding.done)).toBe(true); // never shown again
  expect(errors).toEqual([]);
});

test('accessibility: high contrast outlines every control and turns text white; settings persist', async ({ page }) => {
  const errors = await openWorkspace(page);
  const look = () =>
    page.evaluate(() => {
      const value = (name: string, key: string) => {
        let found: any = null;
        (window as Win).__world.scene.traverse((o: any) => {
          if (o.name === name) found = o;
        });
        return found?.properties.value[key];
      };
      return { title: value('b1:title', 'color'), cardBorder: value('b1:card-0-1', 'borderColor'), sound: value('command:sound-button', 'backgroundColor') };
    });
  const before = await look();
  await tap(page, 'command:contrast-button');
  await page.waitForTimeout(300);
  const after = await look();
  expect(before.title).not.toBe('#ffffff');
  expect(after.title).toBe('#ffffff');
  expect(after.cardBorder).toBe('#ffffff');
  await tap(page, 'command:sound-button'); // sound off: the toggle shows its state as its colour
  await page.waitForTimeout(200);
  expect((await look()).sound).not.toBe(after.sound);
  await page.reload();
  errors.push(...(await openWorkspace(page)));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.settings') ?? '{}'))).toMatchObject({ highContrast: true, sound: false });
  expect((await look()).title).toBe('#ffffff');
  expect(errors).toEqual([]);
});

test('hardening: a spent quota and an unreachable server are explained, never broken', async ({ page }) => {
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/agent/plan', (route) =>
    route.fulfill({ status: 429, json: { ok: false, error: 'That is 20 plans this hour. Try again a little later.' } }),
  );
  const errors = await openWorkspace(page);
  await tap(page, 'command:plan-button');
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'error', null, { timeout: 10_000 });
  expect(await page.evaluate(() => (window as Win).__agent.state.plan.error)).toContain('20 plans this hour');
  await tap(page, 'agent:plan-discard');

  await page.unroute('**/api/agent/plan');
  await page.route('**/api/agent/plan', (route) => route.abort('connectionrefused'));
  await tap(page, 'command:prioritise-button');
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'error', null, { timeout: 10_000 });
  expect(await page.evaluate(() => (window as Win).__agent.state.plan.error)).toContain('did not answer');
  expect(await page.evaluate(() => (window as Win).__workspace.state.boards.length)).toBe(2); // nothing changed
  expect(errors).toEqual([]);
});
