/**
 * Fit to my reach (src/accessibility/reach.ts): one pinch where the hand is comfortable gives distance, height and side.
 * The arithmetic against the shared Layout's focus slot, the voice phrases, and the whole flow in XR: the measuring
 * pinch presses nothing under its ray, the proposal waits on the agent's card, and Apply sets the comfort measured.
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, frames, openWorkspace, pressXR, type Win } from './helpers.js';

const EYES = { x: 0, y: 1.6, z: 0, yaw: 0 };

test("a reach gives distance, height and side: the board's own spot changes nothing", async () => {
  const { comfortFromReach } = await import('../src/accessibility/reach.js');
  // Where the board already sits (0.62 m ahead, 0.17 m below the eyes): nothing to change.
  expect(comfortFromReach(EYES, { x: 0, y: 1.43, z: -0.62 })?.comfort).toEqual({ reach: 1, tiltDeg: 0, side: 'both' });
  // Lying back on a sofa: the hand comes nearer (48 cm: held at 50, the nearest a pinch brings it), higher and right.
  expect(comfortFromReach(EYES, { x: 0.25, y: 1.7, z: -0.4 })?.comfort).toEqual({ reach: 0.8, tiltDeg: 27, side: 'right' });
  // A hand pinched at rest, 30 cm away: the board stops at 50 cm, never against the face (a tester's Quest 3, 2026-11-17).
  expect(comfortFromReach(EYES, { x: 0, y: 1.45, z: -0.26 })?.comfort.reach).toBe(0.8);
  // A shorter reach, a little lower and to the left (an arm that rests on a wheelchair's armrest).
  expect(comfortFromReach(EYES, { x: -0.2, y: 1.4, z: -0.45 })?.comfort).toEqual({ reach: 0.85, tiltDeg: -7, side: 'left' });
  // The anchor's heading counts: facing -X, the board's spot is 0.62 m along -X.
  expect(comfortFromReach({ ...EYES, yaw: Math.PI / 2 }, { x: -0.62, y: 1.43, z: 0 })?.comfort).toEqual({ reach: 1, tiltDeg: 0, side: 'both' });
  // Out of range is held to the engine's limits; too near, or behind, is no reach at all.
  expect(comfortFromReach(EYES, { x: 0, y: 2.6, z: -1.2 })?.comfort).toMatchObject({ reach: 1.8, tiltDeg: 30 });
  expect(comfortFromReach(EYES, { x: 0, y: 1.55, z: -0.15 })).toBeNull();
  expect(comfortFromReach(EYES, { x: 0, y: 1.4, z: 0.5 })).toBeNull();
});

test('nearer, the panels shrink by as much: they look the size they did, and as large as the person chose', async () => {
  const { scaleForReach } = await import('../src/accessibility/reach.js');
  expect(scaleForReach(0.8, 1)).toBe(0.8); // 20% nearer, 20% smaller: the same size to the eyes
  expect(scaleForReach(0.85, 1)).toBe(0.85);
  expect(scaleForReach(0.8, 1.4)).toBe(1.1); // bigger text stays bigger
  expect(scaleForReach(0.8, 0.8)).toBe(0.8); // never below the engine's smallest
  expect(scaleForReach(1, 1.2)).toBe(1.2);
  expect(scaleForReach(1.3, 1)).toBe(1); // further: kept as it was
});

test("a proposal that brings the space nearer without a size gets the step that keeps the panels' size", async () => {
  const { nearerPanelsStep } = await import('../src/accessibility/reach.js');
  const body = { reach: 1, scale: 1, side: 'both' as const, turnDeg: 120, tiltDeg: 0 };
  expect(nearerPanelsStep([{ op: 'set_comfort', reach: 0.75 }, { op: 'set_comfort', turnDeg: 25 }], body, false))
    .toEqual({ op: { op: 'set_comfort', scale: 0.8 }, why: 'Smaller panels, so up close they look the same size' });
  expect(nearerPanelsStep([{ op: 'set_comfort', reach: 0.9 }], { ...body, scale: 1.4 }, true)?.op).toEqual({ op: 'set_comfort', scale: 1.25 });
  expect(nearerPanelsStep([{ op: 'set_comfort', reach: 0.8 }, { op: 'set_comfort', scale: 1.3 }], body, false)).toBeNull(); // it says its size
  expect(nearerPanelsStep([{ op: 'set_comfort', reach: 1.2 }], body, false)).toBeNull(); // further
  expect(nearerPanelsStep([{ op: 'set_comfort', side: 'left' }], body, false)).toBeNull(); // no distance
  expect(nearerPanelsStep([{ op: 'set_comfort', reach: 0.75 }], { ...body, reach: 0.8, scale: 0.8 }, false)).toBeNull(); // already smallest
});

test('fit to my reach by voice, in English and Spanish', async () => {
  const { parseCommand } = await import('../src/voice/commands.js');
  for (const said of ['Fit to my reach', 'fit it to me', 'Measure my reach.', 'Ponlo a mi alcance', 'mide mi alcance', 'hasta dónde llego']) {
    expect(parseCommand(said), said).toEqual({ kind: 'reach' });
  }
  expect(parseCommand('acércalo todo por la derecha')?.kind).not.toBe('reach'); // a description still goes to the agent
});

test('fit to my reach needs hands: on a flat screen it says so and measures nothing', async ({ page }) => {
  const errors = await openWorkspace(page);
  await page.evaluate(() => (window as Win).__voice.say('fit to my reach'));
  expect(await page.evaluate(() => ({ ...(window as Win).__reach.view }))).toMatchObject({ measuring: false, refused: 'not-immersive' });
  expect(errors).toEqual([]);
});

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
const soundOn = async (page: Page) => JSON.parse(await page.evaluate(() => localStorage.getItem('spatialdesk.settings') ?? '{}')).sound ?? true;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1')); // no guided start in the way
});

test('fit to my reach in XR: the pinch measures (and presses nothing), the card proposes, Apply fits the space', async ({ page }) => {
  const errors = await enterXR(page);
  await page.evaluate(() => (window as Win).__voice.say('fit to my reach'));
  expect(await page.evaluate(() => (window as Win).__reach.view.measuring)).toBe(true);

  // Reach nearer, higher and to the right, the ray resting on Sound: the trigger measures, Sound stays on.
  await reachTo(page, 0.4, 0.1, 0.25, 'command:sound-button');
  expect(await page.evaluate(() => (window as Win).__world.scene.getObjectByName('reach-dot-right').visible)).toBe(true);
  await trigger(page, 1);
  await trigger(page, 0);
  await page.waitForFunction(() => !(window as Win).__reach.view.measuring, null, { timeout: 2_000 });
  expect(await soundOn(page)).toBe(true);

  const measured = await page.evaluate(() => (window as Win).__reach.view.last.comfort);
  expect(measured.side).toBe('right');
  expect(measured.reach).toBeGreaterThan(0.6);
  expect(measured.reach).toBeLessThan(0.95);
  expect(measured.tiltDeg).toBeGreaterThan(15);

  // The release did not press the card that opened under the ray: it waits for her.
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => (window as Win).__agent.state);
  expect(card.phase).toBe('preview');
  expect(card.plan.source).toBe('reach');
  expect(card.plan.steps.map((s: any) => s.op)).toEqual([
    { op: 'set_comfort', reach: measured.reach },
    { op: 'set_comfort', scale: measured.reach }, // nearer, smaller by as much: the same size to the eyes
    { op: 'set_comfort', tiltDeg: measured.tiltDeg },
    { op: 'set_comfort', side: 'right' },
  ]);

  await pressXR(page, 'agent:plan-apply');
  await page.waitForFunction((m) => {
    const c = (window as Win).__workspace.state.comfort;
    return c.reach === m.reach && c.scale === m.reach && c.tiltDeg === m.tiltDeg && c.side === m.side;
  }, measured, { timeout: 5_000 });
  expect(errors).toEqual([]);
});

test('a reach measurement can be cancelled by voice, and a pinch afterwards is a pinch again', async ({ page }) => {
  const errors = await enterXR(page);
  await page.evaluate(() => (window as Win).__voice.say('fit to my reach'));
  await page.evaluate(() => (window as Win).__voice.say('cancel'));
  expect(await page.evaluate(() => (window as Win).__reach.view.measuring)).toBe(false);
  expect(await page.evaluate(() => (window as Win).__world.scene.getObjectByName('reach-dot-right').visible)).toBe(false);
  await pressXR(page, 'command:sound-button');
  await page.waitForTimeout(300);
  expect(await soundOn(page)).toBe(false);
  expect(errors).toEqual([]);
});
