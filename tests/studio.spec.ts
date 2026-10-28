/**
 * The VR studio (art direction, Reason to Come Back): the focus board stands on the studio desk wherever the
 * workspace goes, and every finished focus block grows the focus plant a leaf, kept between sessions.
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, settled, type Win } from './helpers.js';

/** The top of the studio desk and the bottom of the focus board's bar, in world metres. */
const deskAndBar = (page: Page) =>
  page.evaluate(() => {
    const w = (window as Win).__world;
    const ws = (window as Win).__workspace.state;
    let bar: any = null;
    w.scene.traverse((o: any) => {
      if (o.name === `${ws.focusBoardId}:handle`) bar = o;
    });
    const point = new w.camera.position.constructor();
    bar.updateWorldMatrix(true, false);
    bar.geometry.computeBoundingBox();
    const min = point.copy(bar.geometry.boundingBox.min).applyMatrix4(bar.matrixWorld).y;
    const max = point.copy(bar.geometry.boundingBox.max).applyMatrix4(bar.matrixWorld).y;
    return { deskTop: w.getSceneObject('studio-desk').position.y as number, barBottom: Math.min(min, max) };
  });

/** Triangles the focus plant draws now (its geometry grows in place). */
const triangles = (page: Page) =>
  page.evaluate(() => {
    let mesh: any = null;
    (window as Win).__world.getSceneObject('focus-plant').traverse((o: any) => {
      if (!mesh && o.isMesh) mesh = o;
    });
    return mesh.geometry.drawRange.count as number;
  });

test('studio: the board stands on the desk wherever it goes, and a focus block grows the plant a leaf', async ({ page }) => {
  const errors = await enterXR(page, '&fast');
  const { deskTop, barBottom } = await deskAndBar(page);
  expect(barBottom - deskTop).toBeGreaterThanOrEqual(0); // standing on it, not sunk into it...
  expect(barBottom - deskTop).toBeLessThan(0.01); // ...nor floating above it

  // "Bring to me" from elsewhere: the desk comes along under the board.
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'arrange_space', layout: 'desk' }, { viewer: { x: 0.8, y: 1.25, z: 0.4, yaw: 1.1, pitch: 0 } }));
  await settled(page); // the board, its desk and the plant slide to the new place
  const moved = await deskAndBar(page);
  expect(moved.barBottom - moved.deskTop).toBeGreaterThanOrEqual(0);
  expect(moved.barBottom - moved.deskTop).toBeLessThan(0.01);

  const growth = await page.evaluate(() => (window as Win).__studio.state.growth as number);
  const before = await triangles(page);
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'start_timer', minutes: 0.1, label: 'Focus' }));
  await page.waitForFunction((g) => (window as Win).__studio.state.growth >= g + 1, growth, { timeout: 30_000 });
  expect(await triangles(page)).toBeGreaterThan(before); // a new leaf, drawn
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.progress')!).blocksEver)).toBe(growth + 1);

  // A break is rest, not a block: the plant waits.
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'start_timer', minutes: 0.1, label: 'Break' }));
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.filter((t: any) => t.state === 'done').length === 2, null, { timeout: 30_000 });
  await page.waitForTimeout(4500);
  expect(await page.evaluate(() => (window as Win).__studio.state.growth)).toBe(growth + 1);
  expect(errors).toEqual([]);
});
