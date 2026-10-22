/**
 * Meta VR Glasses (IWER's profile, ?glasses): a narrower view, eye tracking, and hands without controllers.
 *  - The app measures the view from the headset and fits the layout into it: the focus board, its timer and the
 *    agent's card all stay inside the comfortable view (Meta's p90 perceived 58 x 54 degrees of the glasses' render
 *    extent), whatever the headset (Experience Design and Technical criteria: FoV-aware design).
 *  - Look and pinch, the glasses' primary input: the eyes aim, a pinch of either hand selects, the hands resting.
 *  - Hands-free reads the eyes: a control is pressed by looking at it, with the head still (eyes-only navigation).
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, frames, type Win } from './helpers.js';

const GLASSES_VIEW = { halfWidthDeg: 29, upDeg: 19.9, downDeg: 34.1 };

/** A plan as the command server returns it (the server and Bedrock are covered by server tests and the e2e). */
const PLAN = {
  ok: true,
  summary: 'Your day as two tasks, the report first.',
  steps: [{ op: { op: 'add_card', board: 'Getting started', title: 'Write the report', minutes: 90 }, why: 'The most important task' }],
  source: 'us.amazon.nova-2-lite-v1:0',
  latencyMs: 1200,
  attempts: 1,
};

async function enterGlasses(page: Page, query = ''): Promise<string[]> {
  const errors = await enterXR(page, `&glasses${query}`);
  await page.waitForFunction(() => (window as Win).__workspace.state.view?.halfWidthDeg < 40, null, { timeout: 10_000 });
  await frames(page, 5);
  // Hands at rest in the lap, rays toward the floor: the eyes do the aiming.
  await page.evaluate(() => {
    const device = (window as Win).__xrDevice;
    for (const [side, x] of [['left', -0.2], ['right', 0.2]] as const) {
      const hand = device.hands[side];
      hand.position.set(x, 0.95, -0.25);
      hand.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // pointing down
    }
  });
  await frames(page, 5);
  return errors;
}

/** Each corner of a named element seen from the eyes: degrees left/right (+ right) and up/down (+ up). */
function angularBox(page: Page, name: string) {
  return page.evaluate((name) => {
    const w = (window as Win).__world;
    let o: any = null;
    w.scene.traverse((c: any) => {
      if (c.name === name) o = c;
    });
    if (!o) throw new Error(`no element ${name}`);
    o.updateWorldMatrix(true, false);
    w.camera.updateWorldMatrix(true, false);
    const V = w.camera.position.constructor;
    const toEye = w.camera.matrixWorld.clone().invert();
    const box = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      const p = new V(u, v, 0).applyMatrix4(o.matrixWorld).applyMatrix4(toEye);
      const across = (Math.atan2(p.x, -p.z) * 180) / Math.PI;
      const up = (Math.atan2(p.y, Math.hypot(p.x, p.z)) * 180) / Math.PI;
      box.left = Math.min(box.left, across);
      box.right = Math.max(box.right, across);
      box.bottom = Math.min(box.bottom, up);
      box.top = Math.max(box.top, up);
    }
    return box;
  }, name);
}

/** Turns the emulated eyes (not the head) toward the centre of a named element. */
async function lookWithEyes(page: Page, name: string): Promise<void> {
  await page.evaluate((name) => {
    const w = (window as Win).__world;
    const device = (window as Win).__xrDevice;
    let o: any = null;
    w.scene.traverse((c: any) => {
      if (c.name === name) o = c;
    });
    if (!o) throw new Error(`no element ${name}`);
    o.updateWorldMatrix(true, false);
    w.camera.updateWorldMatrix(true, false);
    const V = w.camera.position.constructor;
    const Q = w.camera.quaternion.constructor;
    // Gaze is viewer-relative: the direction from the eyes, in the head's own frame.
    const target = new V(0, 0, 0).applyMatrix4(o.matrixWorld).applyMatrix4(w.camera.matrixWorld.clone().invert()).normalize();
    const q = new Q().setFromUnitVectors(new V(0, 0, -1), target);
    device.gaze.quaternion.set(q.x, q.y, q.z, q.w);
  }, name);
  await frames(page, 12); // the gaze filter settles and the dwell window agrees
}

async function pinch(page: Page, side: 'left' | 'right' = 'right'): Promise<void> {
  await page.evaluate((side) => (window as Win).__xrDevice.hands[side].updatePinchValue(1), side);
  await frames(page, 4);
  await page.evaluate((side) => (window as Win).__xrDevice.hands[side].updatePinchValue(0), side);
  await frames(page, 4);
}

const column = (page: Page, c: number) =>
  page.evaluate((c) => {
    const ws = (window as Win).__workspace.state;
    return ws.boards.find((b: any) => b.id === ws.focusBoardId).columns[c].cards.map((card: any) => card.title) as string[];
  }, c);

const headPose = (page: Page) =>
  page.evaluate(() => {
    const q = (window as Win).__xrDevice.quaternion;
    return [q.x, q.y, q.z, q.w] as number[];
  });

test('glasses: the layout fits the narrower view the headset reports, with the essentials inside it', async ({ page }) => {
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/agent/plan', (route) => route.fulfill({ json: PLAN }));
  const errors = await enterGlasses(page);
  expect(await page.evaluate(() => (window as Win).__workspace.state.view)).toEqual(GLASSES_VIEW);
  const scale = await page.evaluate(() => (window as Win).__workspace.panelScale as number);
  expect(scale).toBeGreaterThan(0.8);
  expect(scale).toBeLessThan(0.9);
  expect(await page.evaluate(() => (window as Win).__notice.text)).toContain("Fitted to this headset's view");

  await page.evaluate(() => (window as Win).__voice.say('focus'));
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.length === 1);
  await page.evaluate(() => (window as Win).__voice.say('plan my day'));
  await page.waitForFunction(() => (window as Win).__agent?.state.phase === 'preview', null, { timeout: 10_000 });
  await frames(page, 10);

  const ids = await page.evaluate(() => ({ board: (window as Win).__workspace.state.focusBoardId, timer: (window as Win).__workspace.state.timers[0].id }));
  for (const name of [`${ids.board}:board`, `${ids.timer}:timer`, 'agent:plan-root']) {
    const box = await angularBox(page, name);
    expect(box.left, `${name} left edge`).toBeGreaterThanOrEqual(-GLASSES_VIEW.halfWidthDeg);
    expect(box.right, `${name} right edge`).toBeLessThanOrEqual(GLASSES_VIEW.halfWidthDeg);
    expect(box.bottom, `${name} bottom edge`).toBeGreaterThanOrEqual(-GLASSES_VIEW.downDeg);
    expect(box.top, `${name} top edge`).toBeLessThanOrEqual(GLASSES_VIEW.upDeg);
  }
  expect(errors).toEqual([]);
});

test('glasses: look at a card and pinch to pick it up, look at a column and pinch to drop it', async ({ page }) => {
  const errors = await enterGlasses(page);
  const card = (await column(page, 0))[0];
  await lookWithEyes(page, 'b1:card-0-0');
  await pinch(page, 'right');
  expect(await page.evaluate(() => (window as Win).__notice.text)).toContain(card.slice(0, 12));
  await lookWithEyes(page, 'b1:col-2');
  await pinch(page, 'left'); // either hand commits
  await page.waitForFunction((card) => {
    const ws = (window as Win).__workspace.state;
    return ws.boards.find((b: any) => b.id === ws.focusBoardId).columns[2].cards.some((c: any) => c.title === card);
  }, card);
  expect(await column(page, 0)).not.toContain(card);
  expect(errors).toEqual([]);
});

test('glasses: hands-free reads the eyes, so a control is pressed with the head still', async ({ page }) => {
  const errors = await enterGlasses(page, '&handsfree');
  await page.evaluate(() => (window as Win).__voice.say('focus'));
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.length === 1);
  await frames(page, 5);
  const head = await headPose(page);
  const timer = await page.evaluate(() => (window as Win).__workspace.state.timers[0].id as string);
  await lookWithEyes(page, `${timer}:toggle`);
  expect(await page.evaluate(() => (window as Win).__gaze.source)).toBe('eyes');
  await page.waitForFunction(() => (window as Win).__workspace.state.timers[0].state === 'paused', null, { timeout: 4_000 });
  expect(await headPose(page)).toEqual(head);
  expect(errors).toEqual([]);
});
