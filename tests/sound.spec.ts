/**
 * Sound design (Polish): every cue is one soft instrument, placed where it happens, and a quiet ambience plays while a
 * focus block runs: not during a break, not while paused, and never with sounds off.
 */
import { expect, test } from '@playwright/test';
import { openWorkspace, tap, type Win } from './helpers.js';

test('sound: the focus ambience follows focus blocks, never breaks, pauses or sounds off', async ({ page }) => {
  const errors = await openWorkspace(page);
  await tap(page, 'b1:card-0-0'); // a gesture: the browser lets audio start
  await page.waitForFunction(() => (window as Win).__sound.running(), null, { timeout: 5_000 });
  const ambience = () => page.evaluate(() => (window as Win).__sound.ambienceOn() as boolean);
  const dispatch = (op: object) => page.evaluate((op) => (window as Win).__workspace.dispatch(op), op);
  expect(await ambience()).toBe(false);

  await dispatch({ op: 'start_timer', minutes: 25, label: 'Write the report' });
  expect(await ambience()).toBe(true);
  const id = await page.evaluate(() => (window as Win).__workspace.state.timers[0].id as string);
  await dispatch({ op: 'pause_timer', timer: id });
  expect(await ambience()).toBe(false);
  await dispatch({ op: 'resume_timer', timer: id });
  expect(await ambience()).toBe(true);

  await tap(page, 'command:sound-button'); // sounds off: silence
  expect(await ambience()).toBe(false);
  await tap(page, 'command:sound-button');
  expect(await ambience()).toBe(true);

  await dispatch({ op: 'dismiss_timer', timer: id });
  await dispatch({ op: 'start_timer', minutes: 5, label: 'Break' });
  expect(await ambience()).toBe(false); // a break is quiet
  expect(errors).toEqual([]);
});
