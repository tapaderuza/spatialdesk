/**
 * Seated use in the headset (IWER): you look at the panel you tap. The command panel sits 50° to the left, so a press
 * there must not swing the workspace toward it; a real turn (the chair, a new desk) must bring it along.
 */
import { expect, test } from '@playwright/test';
import { enterXR, pressXR, turnHead, type Win } from './helpers.js';

const focusYaw = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const ws = (window as Win).__workspace.state;
    return ws.boards.find((b: any) => b.id === ws.focusBoardId).pose.yaw as number;
  });

test('seated: tapping a side panel never swings the workspace toward it; a real turn does', async ({ page }) => {
  const errors = await enterXR(page);
  const desk = await focusYaw(page);

  await turnHead(page, 50); // looking at the command panel
  await pressXR(page, 'command:focus-button', 'left');
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.length === 1);
  expect(await focusYaw(page)).toBeCloseTo(desk, 3); // Focus 25 kept the desk where it was

  await pressXR(page, 'command:arrange-button', 'left');
  expect(await page.evaluate(() => (window as Win).__notice?.text)).toContain('back around you');
  expect(await focusYaw(page)).toBeCloseTo(desk, 3); // so did Bring to me, pressed with the same glance

  await turnHead(page, 120); // turned round: now the workspace comes along
  await pressXR(page, 'command:arrange-button', 'left');
  expect(await focusYaw(page)).toBeCloseTo(desk + (120 * Math.PI) / 180, 2);
  expect(errors).toEqual([]);
});
