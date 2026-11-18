/**
 * One switch (src/accessibility/switch-system.ts): with ?switch, the command panel's controls light up in turn and one
 * press selects the one lit: the space bar (what switch adapters send) on a screen, a trigger or pinch in XR wherever
 * it points. Pointer taps are ignored meanwhile, and the agent's card takes over the scan while it is open.
 */
import { expect, test, type Page } from '@playwright/test';
import { parseCommand } from '../src/voice/commands.js';
import { enterXR, frames, openWorkspace, pressXR, screenPoint, type Win } from './helpers.js';

/** A brisk scan for the test (the user's own pace is a preference, 0.6 to 6 s). */
const fastScan = (page: Page) =>
  page.addInitScript(() => localStorage.setItem('spatialdesk.access-preferences', JSON.stringify({ scanIntervalMs: 600 })));

const lit = (page: Page) =>
  page.evaluate(() => ({ ...(window as Win).__switch.view }) as { enabled: boolean; surface: string; highlighted: string | null; outlined: boolean });
const settingsNow = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.settings') ?? '{}'));
/** A first visit opens the guided start, modal: one switch skips it too (light Skip, choose it). */
async function skipGuide(page: Page, press: () => Promise<void>): Promise<void> {
  await page.waitForFunction(() => ['coach', 'command'].includes((window as Win).__switch?.view.surface), null, { timeout: 10_000 });
  if ((await lit(page)).surface !== 'coach') return;
  await press();
  await page.waitForFunction(() => (window as Win).__switch.view.highlighted === 'skip', null, { timeout: 5_000 });
  await press();
  await page.waitForFunction(() => (window as Win).__switch.view.surface === 'command', null, { timeout: 5_000 });
}
const waitLit = (page: Page, key: string) =>
  page.waitForFunction((k) => (window as Win).__switch.view.highlighted === k, key, { timeout: 30_000 });

test('one switch on a screen: the space bar walks the console and picks the control lit; a mouse tap does nothing', async ({ page }) => {
  await fastScan(page);
  const errors = await openWorkspace(page, '?switch');
  await skipGuide(page, () => page.keyboard.press('Space'));

  // A tap is not how this person chooses: it presses nothing.
  const sound = await screenPoint(page, 'command:sound-button');
  await page.mouse.click(sound.x, sound.y);
  await page.waitForTimeout(300);
  expect((await settingsNow(page)).sound ?? true).toBe(true);

  // The first press starts the scan, and whichever control is lit is framed in amber, around it and just in front.
  await page.keyboard.press('Space');
  expect((await lit(page)).highlighted).not.toBeNull();
  const framed = await page.evaluate(() => {
    const w = (window as Win).__world;
    const key = (window as Win).__switch.view.highlighted;
    let outline: any = null;
    let control: any = null;
    w.scene.traverse((o: any) => {
      if (o.name === 'switch-outline') outline = o;
      if (o.name === `command:${key}-button` || (!control && o.name.startsWith(`command:${key}`))) control = o;
    });
    const V = w.camera.position.constructor;
    return { visible: outline.visible, offset: outline.getWorldPosition(new V()).distanceTo(control.getWorldPosition(new V())) };
  });
  expect(framed.visible).toBe(true);
  expect(framed.offset).toBeLessThan(0.01);

  // The next press, when Contrast is lit, chooses it.
  await waitLit(page, 'contrast');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(await settingsNow(page)).toMatchObject({ highContrast: true });
  expect(errors).toEqual([]);
});

test('one switch in XR: a trigger anywhere is the switch, and the agent card takes over the scan while open', async ({ page }) => {
  await fastScan(page);
  const errors = await enterXR(page, '&switch');
  await skipGuide(page, () => pressXR(page, 'command:sound-button'));

  // Both presses aim at Sound: the ray does not decide, the scan does.
  await pressXR(page, 'command:sound-button');
  expect((await lit(page)).highlighted).not.toBeNull();
  await waitLit(page, 'contrast');
  await pressXR(page, 'command:sound-button');
  await page.waitForTimeout(300);
  expect(await settingsNow(page)).toMatchObject({ highContrast: true });
  expect((await settingsNow(page)).sound ?? true).toBe(true);

  // The agent's card is modal: the scan walks its own controls while it is shown.
  await page.evaluate(() => (window as Win).__agent.openSession()); // the session card opens without the server
  await page.waitForFunction(() => (window as Win).__switch.view.surface === 'agent', null, { timeout: 5_000 });
  await page.evaluate(() => (window as Win).__agent.close());
  await page.waitForFunction(() => (window as Win).__switch.view.surface === 'command', null, { timeout: 5_000 });
  expect(errors).toEqual([]);
});

test('one switch reaches the boards: a board lit whole is entered, a card moves to another column, and the board lit again leads back out', async ({ page }) => {
  await fastScan(page);
  const errors = await enterXR(page, '&switch');
  await skipGuide(page, () => page.keyboard.press('Space'));
  const cardsIn = (column: number) =>
    page.evaluate((c) => (window as Win).__workspace.state.boards[0].columns[c].cards.map((k: any) => k.title) as string[], column);
  const outlined = () => page.evaluate(() => (window as Win).__switch.view.outlined as boolean);

  // After the console's controls, the first board is lit whole, framed in amber; choosing it walks its own controls.
  await page.keyboard.press('Space');
  await waitLit(page, 'board:b1');
  expect(await outlined()).toBe(true);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as Win).__switch.view.surface === 'board:b1', null, { timeout: 5_000 });

  // The same one press picks a card up, then drops it where the scan has reached.
  const moved = (await cardsIn(0))[0];
  await page.keyboard.press('Space');
  await waitLit(page, 'card-0-0');
  expect(await outlined()).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as Win).__notice?.text ?? '')).toContain('Holding');
  await page.keyboard.press('Space');
  await waitLit(page, 'col-2');
  await page.keyboard.press('Space');
  await expect.poll(() => cardsIn(2)).toContain(moved);
  await frames(page, 30); // the scan rebuilds its list a few times a second: a press before that only restarts it

  // The board lit whole again, last, leads back out to the console.
  await page.keyboard.press('Space');
  await waitLit(page, 'back');
  expect(await outlined()).toBe(true);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as Win).__switch.view.surface === 'command', null, { timeout: 5_000 });

  // A focus timer's own buttons are lit directly, after the boards: one press closes it.
  const timers = () => page.evaluate(() => (window as Win).__workspace.state.timers.length as number);
  await page.keyboard.press('Space');
  await waitLit(page, 'focus');
  await page.keyboard.press('Space');
  await expect.poll(timers).toBe(1);
  const timer = await page.evaluate(() => (window as Win).__workspace.state.timers[0].id as string);
  await frames(page, 30);
  await page.keyboard.press('Space');
  await waitLit(page, `timer:${timer}:dismiss`);
  expect(await outlined()).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(timers).toBe(0);
  expect(errors).toEqual([]);
});

test('switch mode by voice', () => {
  expect(parseCommand('Switch mode on')).toEqual({ kind: 'switch', value: true });
  expect(parseCommand('one button mode off')).toEqual({ kind: 'switch', value: false });
  expect(parseCommand('modo pulsador')).toEqual({ kind: 'switch' });
});
