/**
 * "A bad day? One press asks the AI" (src/agent/day-input.ts): for a judge or a person with no microphone, each press
 * sends one comfort request to the agent, as the same words said to Talk would. The proposal shows each change with its
 * reason, nothing moves until Apply, and one Undo takes it back. Nova's answer is mocked here; the server's planner tests
 * check the real one (server/app AgentTest).
 */
import { expect, test } from '@playwright/test';
import { openWorkspace, tap, type Win } from './helpers.js';

test('a bad day without a microphone: one press asks for comfort, the reasons show, Apply moves, Undo restores', async ({ page }) => {
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  const asked: any[] = [];
  await page.route('**/api/agent/plan', async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        ok: true,
        summary: 'Closer and lower, so your neck can rest.',
        steps: [
          { op: { op: 'set_comfort', reach: 0.8 }, why: 'Closer: less reaching' },
          { op: { op: 'set_comfort', tiltDeg: -10 }, why: 'Lower: no looking up' },
        ],
        source: 'us.amazon.nova-2-lite-v1:0',
      },
    });
  });
  const errors = await openWorkspace(page);
  const comfort = () => page.evaluate(() => ({ ...(window as Win).__workspace.state.comfort }));
  const before = await comfort();

  await expect(page.locator('#day-badday-0')).toHaveText('Neck hurts');
  await expect(page.locator('#day-badday-1')).toHaveText('Tired eyes');
  await expect(page.locator('#day-badday-2')).toHaveText('Left hand only');
  await page.locator('#day-badday-0').click();
  await expect(page.locator('#day-status')).toContainText('nothing moves until you press Apply');

  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ intent: 'comfort', text: 'My neck hurts today. Bring everything closer, and keep my head turns small.' });
  expect(await comfort(), 'nothing moves before Apply').toEqual(before);

  await tap(page, 'agent:plan-apply');
  await expect.poll(async () => (await comfort()).reach).toBe(0.8);
  expect((await comfort()).tiltDeg).toBe(-10);
  await page.evaluate(() => (window as Win).__voice.say('undo'));
  expect(await comfort(), 'one Undo takes it back').toEqual(before);
  expect(errors).toEqual([]);
});

test('"Use the example" fills Describe your day, so Plan my day plans real words rather than the starter boards alone', async ({ page }) => {
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  const asked: any[] = [];
  await page.route('**/api/agent/plan', async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, summary: 'Your day as one board.', steps: [{ op: { op: 'start_timer', minutes: 25, label: 'Report' }, why: 'The report first' }], source: 'us.amazon.nova-2-lite-v1:0' } });
  });
  const errors = await openWorkspace(page);
  const example = await page.locator('#day-text').getAttribute('placeholder');
  expect(await page.locator('#day-text').inputValue()).toBe('');
  await page.locator('#day-example').click();
  expect(await page.locator('#day-text').inputValue()).toBe(example);
  expect(await page.evaluate(() => localStorage.getItem('spatialdesk.day'))).toBe(example);
  await expect(page.locator('#day-status')).toContainText('Example added');
  await page.locator('#day-plan').click();
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  expect(asked[0]).toMatchObject({ intent: 'plan_my_day', text: example });
  expect(errors).toEqual([]);
});
