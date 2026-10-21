/**
 * Hands-free (look and hold), in the IWER Quest 3 emulator, with the head as the only input: resting the centre of
 * the view on a control presses it once the ring fills; a glance, a short read of a card, or a gaze that stays after
 * a press never presses anything. Accessibility award criteria: navigation for users with limited mobility.
 */
import { expect, test } from '@playwright/test';
import { enterXR, frames, lookAt, pressXR, type Win } from './helpers.js';

const timers = (page: import('@playwright/test').Page) => page.evaluate(() => (window as Win).__workspace.state.timers.length);

test('hands-free: a held gaze presses, a glance does not, and a press never repeats', async ({ page }) => {
  const errors = await enterXR(page, '&handsfree');
  expect(await timers(page)).toBe(0);

  await lookAt(page, 'command:focus-button');
  await page.waitForTimeout(600); // a glance: the ring starts filling...
  expect(await page.evaluate(() => (window as Win).__gaze.key)).toBe('focus');
  await lookAt(page, 'b1:title'); // ...and the gaze moves on
  await page.waitForTimeout(400);
  expect(await timers(page)).toBe(0);

  await lookAt(page, 'command:focus-button'); // held: Focus 25 starts
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.length === 1, null, { timeout: 3_000 });
  await page.waitForTimeout(2_500); // still looking: never pressed twice
  expect(await timers(page)).toBe(1);
  expect(await page.evaluate(() => (window as Win).__gaze.presses)).toBe(1);

  await lookAt(page, 'command:undo-button'); // and undone the same way
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.length === 0, null, { timeout: 3_000 });
  expect(errors).toEqual([]);
});

test('hands-free: cards move by gaze alone, and reading a card does not pick it up', async ({ page }) => {
  const errors = await enterXR(page, '&handsfree');
  const held = () => page.evaluate(() => (window as Win).__notice?.text ?? '');
  const doing = () =>
    page.evaluate(() => {
      const ws = (window as Win).__workspace.state;
      return ws.boards.find((b: any) => b.id === ws.focusBoardId).columns[1].cards.map((c: any) => c.title);
    });
  const before = await doing();

  await lookAt(page, 'b1:card-0-0');
  await page.waitForTimeout(1_100); // reading the title: cards wait longer than buttons
  expect(await held()).not.toContain('Holding');
  await page.waitForFunction(() => (window as Win).__notice?.text?.startsWith('Holding'), null, { timeout: 3_000 });

  await lookAt(page, 'b1:col-1', 0, -0.4); // the Doing column, below its cards
  await page.waitForFunction((n) => {
    const ws = (window as Win).__workspace.state;
    return ws.boards.find((b: any) => b.id === ws.focusBoardId).columns[1].cards.length === n + 1;
  }, before.length, { timeout: 4_000 });
  expect(errors).toEqual([]);
});

test('hands-free: the toggle on the command panel turns it on and off, and says how it works', async ({ page }) => {
  const errors = await enterXR(page);
  await pressXR(page, 'command:handsfree-button');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.settings') ?? '{}').handsFree)).toBe(true);
  expect(await page.evaluate(() => (window as Win).__notice?.text)).toContain('hold your gaze');

  // The reticle shows on the panel looked at, and only in hands-free.
  await lookAt(page, 'command:sound-button');
  await frames(page, 3);
  const reticle = () =>
    page.evaluate(() => {
      let visible = false;
      (window as Win).__world.scene.traverse((o: any) => {
        if (o.name === 'gaze-reticle') visible = o.visible;
      });
      return visible;
    });
  expect(await reticle()).toBe(true);

  await lookAt(page, 'command:handsfree-button'); // turned off by gaze too
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('spatialdesk.settings') ?? '{}').handsFree === false, null, { timeout: 3_000 });
  await frames(page, 3);
  expect(await reticle()).toBe(false);
  expect(errors).toEqual([]);
});
