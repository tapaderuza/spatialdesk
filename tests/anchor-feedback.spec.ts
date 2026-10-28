/**
 * Feedback when the space settles (src/ui/anchor-feedback.ts): an amber frame round the work board that fades in 0.6 s,
 * and a faint pulse in the controllers that have a motor, when the comfort profile's reach, tilt or side changes and when
 * Fit room stands the board on a surface. Nothing happens for a change that moves nothing, and between events the frame
 * is hidden (nothing drawn, nothing updated).
 */
import { expect, test } from '@playwright/test';
import { enterXR, frames, settled, type Win } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1')); // no guided start in the way
});

test('the space settling flashes the work board in amber and pulses the controllers, once, and fades', async ({ page }) => {
  const errors = await enterXR(page);
  const view = () => page.evaluate(() => ({ ...(window as Win).__anchor.view }) as { flashes: number; pulses: number; last: string | null; visible: boolean });
  const frame = () => page.evaluate(() => {
    const f = (window as Win).__world.scene.getObjectByName('anchor-flash');
    return { visible: f.visible, opacity: f.material.opacity, scale: f.scale.x };
  });
  expect(await view()).toMatchObject({ flashes: 0, pulses: 0, visible: false });
  expect((await frame()).visible).toBe(false);

  // A change of reach: the frame appears on the work board, with a pulse for every controller that can vibrate.
  const motors = await page.evaluate(() => [...(window as Win).__world.session.inputSources].filter((s: any) => s.gamepad?.hapticActuators?.[0]?.pulse).length);
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'set_comfort', reach: 0.8 }));
  await settled(page); // the flash comes when the board has finished sliding there (src/ui/glide.ts)
  expect(await view()).toMatchObject({ flashes: 1, last: 'reach', visible: true, pulses: motors });
  const shown = await frame();
  expect(shown.visible).toBe(true);
  expect(shown.opacity).toBeGreaterThan(0.1);
  const onBoard = await page.evaluate(() => {
    const w = (window as Win).__world;
    const state = (window as Win).__workspace.state;
    const pose = state.boards.find((b: any) => b.id === state.focusBoardId).pose;
    const f = w.scene.getObjectByName('anchor-flash');
    return { dx: f.position.x - pose.x, dy: f.position.y - pose.y, dz: f.position.z - pose.z, yaw: f.rotation.y - pose.yaw };
  });
  expect(Math.hypot(onBoard.dx, onBoard.dy, onBoard.dz)).toBeLessThan(0.001);
  expect(Math.abs(onBoard.yaw)).toBeLessThan(0.001);

  // It fades out by itself and is hidden again.
  await page.waitForFunction(() => !(window as Win).__anchor.view.visible, null, { timeout: 3_000 });
  expect((await frame()).visible).toBe(false);

  // The same reach again moves nothing: no second flash.
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'set_comfort', reach: 0.8 }));
  await frames(page, 4);
  expect((await view()).flashes).toBe(1);

  // Fit room says the board stands on a surface: the same flash, called "surface".
  await page.evaluate(() => (window as Win).__anchor.announce('surface'));
  await frames(page, 2);
  expect(await view()).toMatchObject({ flashes: 2, last: 'surface', visible: true });
  expect(errors).toEqual([]);
});

test('a flat screen (no session) flashes and never touches a controller', async ({ page }) => {
  await page.goto('/?emulate');
  await page.waitForFunction(() => (window as Win).__anchor && (window as Win).__workspace, null, { timeout: 60_000 });
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'set_comfort', side: 'right' }));
  await frames(page, 3);
  expect(await page.evaluate(() => ({ ...(window as Win).__anchor.view }))).toMatchObject({ flashes: 1, pulses: 0, last: 'reach' });
});
