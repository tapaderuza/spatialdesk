/**
 * One switch (src/accessibility/switch-system.ts): with ?switch, the command panel's controls light up in turn and one
 * press selects the one lit: the space bar (what switch adapters send) on a screen, a trigger or pinch in XR wherever
 * it points. Pointer taps are ignored meanwhile, and the agent's card takes over the scan while it is open.
 */
import { expect, test, type Page } from '@playwright/test';
import { parseCommand } from '../src/voice/commands.js';
import { enterXR, openWorkspace, pressXR, screenPoint, type Win } from './helpers.js';

/** A brisk scan for the test (the user's own pace is a preference, 0.6 to 6 s). */
const fastScan = (page: Page) =>
  page.addInitScript(() => localStorage.setItem('spatialdesk.access-preferences', JSON.stringify({ scanIntervalMs: 600 })));

const lit = (page: Page) => page.evaluate(() => ({ ...(window as Win).__switch.view }) as { enabled: boolean; surface: string; highlighted: string | null });
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

  // The first press starts the scan; the next press, when Contrast is lit, chooses it.
  await page.keyboard.press('Space');
  expect((await lit(page)).highlighted).not.toBeNull();
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

test('switch mode by voice', () => {
  expect(parseCommand('Switch mode on')).toEqual({ kind: 'switch', value: true });
  expect(parseCommand('one button mode off')).toEqual({ kind: 'switch', value: false });
  expect(parseCommand('modo pulsador')).toEqual({ kind: 'switch' });
});
