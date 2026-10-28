/**
 * The guided setup (src/onboarding/setup.ts): three questions for someone new to all this, hands only.
 *   1. "Where are you sitting?"  [Desk] / [Sofa / Bed]
 *   2. "Reach out and pinch this orb": an orb 50 cm from the eyes; the pinch's own distance, height and side become the
 *      comfort profile (the pinch presses nothing under its ray)
 *   3. "Do you need pointer stabilization?"  [Yes] / [No]: steady aim (tremor mode) on or off
 * It opens by itself the first time someone enters XR, can be skipped, and comes back by voice ("recalibrate") or from
 * the My setup card. The first-run coach waits for it.
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, frames, openWorkspace, pressXR, tap, type Win } from './helpers.js';

// A visitor who has never been through it: no "calibrated" flag (playwright.config.ts seeds one for every other test).
test.use({ storageState: { cookies: [], origins: [] } });

const view = (page: Page) => page.evaluate(() => ({ ...(window as Win).__setup.view }));
const stageIs = (page: Page, stage: string | null) => page.waitForFunction((s) => (window as Win).__setup.view.stage === s, stage, { timeout: 10_000 });
const flag = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const preferences = async (page: Page) => JSON.parse((await flag(page, 'spatialdesk.access-preferences')) ?? '{}');

/** Moves the right controller to [ahead, up, right] metres from the anchor's eyes, its ray on [target]. */
async function reachTo(page: Page, ahead: number, up: number, right: number, target: string): Promise<void> {
  await page.evaluate(
    ({ ahead, up, right, target }) => {
      const w = (window as Win).__world;
      const a = (window as Win).__workspace.state.anchor;
      const controller = (window as Win).__xrDevice.controllers.right;
      const V = w.camera.position.constructor;
      const Q = w.camera.quaternion.constructor;
      const point = new V(a.x + right * Math.cos(a.yaw) - ahead * Math.sin(a.yaw), a.y + up, a.z - right * Math.sin(a.yaw) - ahead * Math.cos(a.yaw));
      const aim = w.scene.getObjectByName(target).getWorldPosition(new V()).sub(point).normalize();
      const q = new Q().setFromUnitVectors(new V(0, 0, -1), aim);
      controller.position.set(point.x, point.y, point.z);
      controller.quaternion.set(q.x, q.y, q.z, q.w);
    },
    { ahead, up, right, target },
  );
  await frames(page, 10);
}
const trigger = async (page: Page, value: number) => {
  await page.evaluate((v) => (window as Win).__xrDevice.controllers.right.updateButtonValue('trigger', v), value);
  await frames(page, 4);
};
/**
 * Whether [name] and everything above it is shown. A UIKit element is drawn through its panel, so its own three.js
 * `visible` is false while its `isVisible` signal says whether it is laid out and shown: that signal counts for it.
 */
const shown = (page: Page, name: string) =>
  page.evaluate((n) => {
    let o = (window as Win).__world.scene.getObjectByName(n);
    if (!o) return false;
    for (; o; o = o.parent) if (o.isVisible ? !o.isVisible.value : !o.visible) return false;
    return true;
  }, name);

test('a new visitor in XR: where they sit, an orb to pinch, steady aim; the space fits, the coach follows', async ({ page }) => {
  const errors = await enterXR(page);
  await stageIs(page, 'where');
  expect(await view(page)).toMatchObject({ step: 'Step 1 of 3', title: 'Where are you sitting?', a: 'Desk', b: 'Sofa/Bed' });
  await expect.poll(() => shown(page, 'setup:setup-a')).toBe(true); // UIKit lays the panel out a frame or two after it opens
  expect(await shown(page, 'coach:coach-text')).toBe(false); // the first-run coach waits for the setup

  // The panel stands in front of the eyes, facing them.
  const placed = await page.evaluate(() => {
    const a = (window as Win).__workspace.state.anchor;
    const p = (window as Win).__world.scene.getObjectByName('setup:setup-root').getWorldPosition(new ((window as Win).__world.camera.position.constructor)());
    const ahead = -(p.x - a.x) * Math.sin(a.yaw) - (p.z - a.z) * Math.cos(a.yaw);
    return { ahead, side: (p.x - a.x) * Math.cos(a.yaw) - (p.z - a.z) * Math.sin(a.yaw), up: p.y - a.y };
  });
  expect(placed.ahead).toBeGreaterThan(0.45);
  expect(placed.ahead).toBeLessThan(0.7);
  expect(Math.abs(placed.side)).toBeLessThan(0.05);

  // Step 1: the desk.
  await pressXR(page, 'setup:setup-a');
  await stageIs(page, 'reach');
  expect(await view(page)).toMatchObject({ step: 'Step 2 of 3', title: 'Reach out and pinch this orb', seat: 'desk' });
  expect(await flag(page, 'spatialdesk.seat')).toBe('desk');

  // Step 2: an orb 50 cm from the eyes; a hand dot rides on each hand (the reach measurement is running).
  const orb = await page.evaluate(() => {
    const a = (window as Win).__workspace.state.anchor;
    const o = (window as Win).__world.scene.getObjectByName('setup-orb');
    return { visible: o.visible, distance: Math.hypot(o.position.x - a.x, o.position.y - a.y, o.position.z - a.z) };
  });
  expect(orb.visible).toBe(true);
  expect(orb.distance).toBeCloseTo(0.5, 2);
  expect(await page.evaluate(() => (window as Win).__reach.view.measuring)).toBe(true);

  // Pinch a little nearer and to the right than the orb, the ray resting on Sound: it measures, and Sound stays on.
  await reachTo(page, 0.42, -0.18, 0.12, 'command:sound-button');
  await trigger(page, 1);
  await trigger(page, 0);
  await stageIs(page, 'steady');
  const measured = await page.evaluate(() => (window as Win).__setup.view.reach.comfort);
  expect(measured.reach).toBeGreaterThan(0.6);
  expect(measured.reach).toBeLessThan(0.95);
  expect(JSON.parse((await flag(page, 'spatialdesk.settings')) ?? '{}').sound ?? true).toBe(true);
  expect(await page.evaluate(() => (window as Win).__world.scene.getObjectByName('setup-orb').visible)).toBe(false);
  // Noted, not applied yet: the boards would come in front of the question panel and take the ray meant for its buttons.
  expect((await page.evaluate(() => (window as Win).__workspace.state.comfort)).reach).toBe(1);
  expect(await page.evaluate(() => (window as Win).__anchor.view.flashes)).toBe(0);

  // Step 3: yes, my hand shakes.
  expect(await view(page)).toMatchObject({ step: 'Step 3 of 3', title: 'Do you need pointer stabilization?', a: 'Yes', b: 'No' });
  await pressXR(page, 'setup:setup-a');
  await stageIs(page, 'done');
  expect((await preferences(page)).tremorTolerance).toBe(true);
  expect((await view(page)).hint).toContain('recalibrate');
  expect((await view(page)).hint).toMatch(/board \d+ cm away, steady aim on/);

  // Done: Start closes it, remembers it, and the space settles on the hand's own reach (amber frame, pulse), in one Undo.
  await pressXR(page, 'setup:setup-a');
  await stageIs(page, null);
  expect(await view(page)).toMatchObject({ finished: true, skipped: false });
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort)).toMatchObject({ reach: measured.reach, tiltDeg: measured.tiltDeg, side: measured.side });
  expect(await page.evaluate(() => (window as Win).__anchor.view.flashes)).toBeGreaterThan(0);
  await page.evaluate(() => (window as Win).__voice.say('undo'));
  expect((await page.evaluate(() => (window as Win).__workspace.state.comfort)).reach).toBe(1);
  expect(await flag(page, 'spatialdesk.calibrated')).toBe('1');
  expect(await shown(page, 'setup:setup-root')).toBe(false);
  await expect.poll(() => shown(page, 'coach:coach-text'), { timeout: 5_000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('sofa or bed is remembered; the hand that cannot reach the orb moves on; "No" leaves the aim as it was', async ({ page }) => {
  const errors = await enterXR(page);
  await stageIs(page, 'where');
  await pressXR(page, 'setup:setup-b');
  await stageIs(page, 'reach');
  expect(await view(page)).toMatchObject({ seat: 'sofa' });
  expect(await flag(page, 'spatialdesk.seat')).toBe('sofa');
  // The orb is an invitation under the panel, never in front of a button, whichever seat was chosen.
  const orbDrop = await page.evaluate(() => (window as Win).__workspace.state.anchor.y - (window as Win).__world.scene.getObjectByName('setup-orb').position.y);
  expect(orbDrop).toBeGreaterThan(0.12);

  // Not everyone can reach it: Skip this step, and nothing about the space changes.
  const before = await page.evaluate(() => (window as Win).__workspace.state.comfort);
  expect(await page.evaluate(() => (window as Win).__reach.view.measuring)).toBe(true);
  await page.evaluate(() => (window as Win).__voice.say('cancel')); // the measurement waits for a pinch; saying so moves on
  await stageIs(page, 'steady');
  expect(await page.evaluate(() => (window as Win).__reach.view.measuring)).toBe(false);
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort)).toEqual(before);

  await pressXR(page, 'setup:setup-b'); // No
  await stageIs(page, 'done');
  expect((await preferences(page)).tremorTolerance ?? false).toBe(false);
  await pressXR(page, 'setup:setup-a');
  await stageIs(page, null);
  expect(errors).toEqual([]);
});

test('Skip closes the setup, counts as done, and changes nothing', async ({ page }) => {
  const errors = await enterXR(page);
  await stageIs(page, 'where');
  const before = await page.evaluate(() => (window as Win).__workspace.state.comfort);
  await pressXR(page, 'setup:setup-skip');
  await stageIs(page, null);
  expect(await view(page)).toMatchObject({ finished: true, skipped: true });
  expect(await flag(page, 'spatialdesk.calibrated')).toBe('1');
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort)).toEqual(before);
  expect(await page.evaluate(() => (window as Win).__reach.view.measuring)).toBe(false);
  expect(errors).toEqual([]);
});

test('"recalibrate" brings it back for someone who has done it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.calibrated', '1'));
  const errors = await enterXR(page);
  expect((await view(page)).stage).toBeNull(); // calibrated: it does not open by itself
  await page.evaluate(() => (window as Win).__voice.say('recalibrate'));
  await stageIs(page, 'where');
  await expect.poll(() => shown(page, 'setup:setup-a')).toBe(true);
  await pressXR(page, 'setup:setup-skip');
  await stageIs(page, null);
  expect(errors).toEqual([]);
});

test('on a flat screen it does not open by itself; with ?setup it asks, and the orb step (which needs hands) is skipped', async ({ page }) => {
  const errors = await openWorkspace(page);
  expect((await view(page)).stage).toBeNull();
  await page.goto('/?emulate&setup');
  await page.waitForFunction(() => (window as Win).__setup?.view.stage === 'where', null, { timeout: 30_000 });
  await page.evaluate(() => (window as Win).__setup.choose('a'));
  await stageIs(page, 'steady'); // no hands, no orb
  expect((await view(page)).title).toBe('Do you need pointer stabilization?');
  expect(errors).toEqual([]);
});

test.describe('in Spanish', () => {
  test('the questions are in Spanish when the link asks for it', async ({ page }) => {
    const errors = await enterXR(page, '&lang=es-ES');
    await stageIs(page, 'where');
    expect(await view(page)).toMatchObject({ step: 'Paso 1 de 3', title: 'Donde te sientas?', a: 'Escritorio', b: 'Sofa/Cama' });
    await pressXR(page, 'setup:setup-a');
    await stageIs(page, 'reach');
    expect((await view(page)).title).toBe('Estira la mano y pellizca este orbe');
    expect(errors).toEqual([]);
  });
});
