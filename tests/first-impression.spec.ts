/**
 * The first seconds, as a judge meets them: a dark splash instead of a white page, a start card that says what this is
 * and offers Enter VR only where there is VR, a welcome in the headset (the setup's for a newcomer, a quiet banner for
 * someone back) that goes as soon as they act; and the space feeling physical: a soft shadow behind every board and
 * timer (one draw call for all), and a card that rises a little under the pointer.
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, frames, openWorkspace, settled, tap, type Win } from './helpers.js';

test('a dark splash covers the load and then gets out of the way; the tab is called SpatialDesk', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForSelector('#splash', { timeout: 10_000 });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(15, 18, 23)'); // never white
  await page.waitForFunction(() => (window as Win).__world, null, { timeout: 60_000 });
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 5_000 });
  await expect(page).toHaveTitle('SpatialDesk');
});

test('the start card: on a screen with no headset it says so and shows no Enter VR', async ({ page }) => {
  const errors = await openWorkspace(page);
  await expect(page.locator('#day-input')).toContainText('Welcome to SpatialDesk');
  await expect(page.locator('#day-welcome')).toContainText('No headset here');
  await expect(page.locator('#day-vr')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the start card: where there is VR, its Enter VR enters it', async ({ page }) => {
  await page.goto('/?emulate');
  await page.waitForFunction(() => (window as Win).__world && (window as Win).__xrDevice, null, { timeout: 60_000 });
  await expect(page.locator('#day-vr')).toBeVisible();
  await page.locator('#day-vr').click();
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
});

const welcome = (page: Page) => page.evaluate(() => ({ ...(window as Win).__welcome }) as { shown: boolean; greeted: boolean; title: string; line: string });

test('someone back gets a quiet welcome above the board, and it goes as soon as they act', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await enterXR(page);
  await page.waitForFunction(() => (window as Win).__welcome.shown, null, { timeout: 5_000 });
  expect(await welcome(page)).toMatchObject({ greeted: true, title: 'Welcome back', line: 'Say "Plan my day", or pinch it on your panel.' });
  // Above the work board.
  const placed = await page.evaluate(() => {
    const w = window as Win;
    let banner: any = null;
    let card: any = null;
    w.__world.scene.traverse((o: any) => {
      if (o.name === 'welcome:root') banner = o;
      if (o.name === 'b1:card-0-0') card = o;
    });
    banner.updateWorldMatrix(true, false);
    card.updateWorldMatrix(true, false);
    return { banner: banner.matrixWorld.elements[13], card: card.matrixWorld.elements[13] };
  });
  expect(placed.banner).toBeGreaterThan(placed.card);
  // The person starts: Focus 25 by voice. The welcome fades out.
  await page.evaluate(() => (window as Win).__voice.say('focus'));
  await page.waitForFunction(() => !(window as Win).__welcome.shown, null, { timeout: 3_000 });
  expect(errors).toEqual([]);
});

test('someone new gets the guided setup, whose first line is the welcome; no banner on top of it', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('spatialdesk.calibrated'));
  const errors = await enterXR(page);
  await page.waitForFunction(() => (window as Win).__setup.view.stage === 'where', null, { timeout: 5_000 });
  expect(await page.evaluate(() => (window as Win).__setup.view.hint)).toBe('Welcome. Three quick questions fit this space to your body. Skip any time.');
  await frames(page, 30);
  expect((await welcome(page)).greeted).toBe(false);
  expect(errors).toEqual([]);
});

test('in VR there is no shadow to pay for; in passthrough every board and timer casts one, all in one draw call', async ({ page }) => {
  test.setTimeout(120_000);
  // VR: the dusk sky is too dark for a shadow to show, so none is drawn.
  const errors = await openWorkspace(page, '?emulate&fast&room=office_small');
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await frames(page, 10);
  expect(await page.evaluate(() => ({ count: (window as Win).__shadows.count(), visible: (window as Win).__shadows.mesh.visible }))).toEqual({ count: 0, visible: false });
  await page.evaluate(() => (window as Win).__world.session.end());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'non-immersive', null, { timeout: 15_000 });

  // The room (passthrough): one shadow per board and timer, in one instanced mesh, each right behind its panel.
  await tap(page, 'command:room-button');
  await page.waitForFunction(() => (window as Win).__room?.state.inRoom, null, { timeout: 30_000 });
  await frames(page, 10);
  const panels = () => page.evaluate(() => (window as Win).__workspace.state.boards.length + (window as Win).__workspace.state.timers.length);
  expect(await page.evaluate(() => (window as Win).__shadows.mesh.isInstancedMesh)).toBe(true);
  expect(await page.evaluate(() => (window as Win).__shadows.count())).toBe(await panels());
  await page.evaluate(() => (window as Win).__voice.say('focus')); // a timer appears: one more shadow
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.length === 1);
  await settled(page);
  expect(await page.evaluate(() => (window as Win).__shadows.count())).toBe(await panels());
  const gaps = await page.evaluate(() => {
    const w = window as Win;
    const mesh = w.__shadows.mesh;
    const M = mesh.matrixWorld.constructor;
    const V = w.__world.camera.position.constructor;
    const instances = Array.from({ length: mesh.count }, (_, i) => {
      const m = new M();
      mesh.getMatrixAt(i, m);
      return new V().setFromMatrixPosition(m);
    });
    return w.__workspace.state.boards.map((b: any) => Math.min(...instances.map((p: any) => Math.hypot(p.x - b.pose.x, p.y - b.pose.y, p.z - b.pose.z))));
  });
  for (const gap of gaps) expect(gap, 'a shadow sits a couple of centimetres behind and below each board').toBeLessThan(0.04);
  expect(errors).toEqual([]);
});

test('a card under the pointer lightens and rises a little, and settles back when the pointer leaves', async ({ page }) => {
  const errors = await enterXR(page);
  const scaleOf = () =>
    page.evaluate(() => {
      const w = window as Win;
      let card: any = null;
      w.__world.scene.traverse((o: any) => {
        if (o.name === 'b1:card-0-1') card = o;
      });
      card.updateWorldMatrix(true, false);
      return new (w.__world.camera.position.constructor)().setFromMatrixScale(card.matrixWorld).x as number;
    });
  const aim = (name: string | null) =>
    page.evaluate((name) => {
      const w = window as Win;
      const V = w.__world.camera.position.constructor;
      const Q = w.__world.camera.quaternion.constructor;
      const c = w.__xrDevice.controllers.right;
      const from = new V(0.18, 1.3, -0.25);
      let target = new V(2, 0.3, -0.5); // off to the side, at nothing
      if (name) {
        let el: any = null;
        w.__world.scene.traverse((o: any) => {
          if (o.name === name) el = o;
        });
        el.updateWorldMatrix(true, false);
        target = new V().setFromMatrixPosition(el.matrixWorld);
      }
      const q = new Q().setFromUnitVectors(new V(0, 0, -1), target.sub(from).normalize());
      c.position.set(from.x, from.y, from.z);
      c.quaternion.set(q.x, q.y, q.z, q.w);
    }, name);
  await aim(null);
  await frames(page, 30);
  const resting = await scaleOf();
  await aim('b1:card-0-1');
  await page.waitForTimeout(600); // the 300 ms fade, and some
  const risen = await scaleOf();
  expect(risen / resting).toBeGreaterThan(1.025);
  expect(risen / resting).toBeLessThan(1.05); // a little, never loud
  await aim(null);
  await page.waitForTimeout(700); // the 400 ms fade back
  expect(Math.abs((await scaleOf()) / resting - 1)).toBeLessThan(0.002);
  expect(errors).toEqual([]);
});
