/**
 * Panels slide, they do not jump: when the space moves onto the body's comfort zone (the AI's answer, the guided setup,
 * an undo) every board glides to its new place in well under a second, with no frame that moves more than a small share
 * of the way, ends exactly on the engine's pose, and the amber frame and the pulse come when it has settled. A flat
 * screen, a panel at first placement and the reduced-motion preference place at once.
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, frames, openWorkspace, settled, type Win } from './helpers.js';

interface Sample { t: number; x: number; y: number; z: number; active: number; flashes: number }

/** Dispatches [ops] and records a board's card position, how many panels are still gliding and the flashes, per frame. */
async function recordAfter(page: Page, action: 'comfort' | 'undo', reach = 1.4, count = 150): Promise<{ before: { x: number; y: number; z: number }; samples: Sample[] }> {
  return page.evaluate(
    async ({ action, reach, count }) => {
      const w = window as Win;
      const world = w.__world;
      let element: any = null;
      world.scene.traverse((o: any) => {
        if (o.name === 'b1:card-0-0') element = o;
      });
      const V = world.camera.position.constructor;
      const probe = new V();
      const position = () => {
        element.updateWorldMatrix(true, false);
        return probe.setFromMatrixPosition(element.matrixWorld);
      };
      const here = position();
      const before = { x: here.x, y: here.y, z: here.z };
      const a = w.__workspace.state.anchor;
      if (action === 'comfort') w.__workspace.dispatch({ op: 'set_comfort', reach }, { label: 'glide test', viewer: { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: 0 } });
      else w.__workspace.undo();
      const samples: Sample[] = [];
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const p = position();
          samples.push({ t: performance.now() - started, x: p.x, y: p.y, z: p.z, active: w.__glide.active(), flashes: w.__anchor.view.flashes });
          if (samples.length >= count) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { before, samples };
    },
    { action, reach, count },
  );
}

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The largest move of one frame, the total move, and when the board was within a millimetre of where it ended. */
function profile(before: { x: number; y: number; z: number }, samples: Sample[]) {
  const end = samples[samples.length - 1];
  const total = distance(before, end);
  let biggestStep = distance(before, samples[0]);
  for (let i = 1; i < samples.length; i++) biggestStep = Math.max(biggestStep, distance(samples[i - 1], samples[i]));
  const arrived = samples.find((s) => distance(s, end) < 0.001)!;
  return { total, biggestStep, arrivedMs: arrived.t, end };
}

test('a comfort change glides: no frame jumps, it arrives in under 1.6 s, and the undo glides back', async ({ page }) => {
  const errors = await enterXR(page, '&fast');
  await frames(page, 30);

  const { before, samples } = await recordAfter(page, 'comfort');
  const go = profile(before, samples);
  console.log(`GLIDE moved ${(go.total * 100).toFixed(1)} cm, biggest frame ${(go.biggestStep * 100).toFixed(2)} cm (${((go.biggestStep / go.total) * 100).toFixed(1)}% of the way), within 1 mm after ${Math.round(go.arrivedMs)} ms`);
  expect(go.total, 'the board moved a visible distance').toBeGreaterThan(0.08);
  expect(go.biggestStep, 'no single frame carries more than a small share of the way').toBeLessThan(go.total * 0.2);
  expect(go.arrivedMs).toBeGreaterThan(300); // not a jump
  expect(go.arrivedMs).toBeLessThan(1600); // not a drift
  expect(samples[samples.length - 1].active).toBe(0); // everything has come to rest and stopped being updated
  // At rest it is exactly where the engine put it: the last frames do not differ at all.
  expect(distance(samples[samples.length - 1], samples[samples.length - 10])).toBeLessThan(1e-9);

  await frames(page, 10);
  const back = await recordAfter(page, 'undo');
  const undone = profile(back.before, back.samples);
  expect(undone.total).toBeGreaterThan(0.08);
  expect(undone.biggestStep).toBeLessThan(undone.total * 0.2);
  expect(distance(undone.end, before), 'the undo glides back to where it began').toBeLessThan(0.001);
  expect(errors).toEqual([]);
});

test('the amber frame and the pulse come when the board has settled, not while it is on the way', async ({ page }) => {
  const errors = await enterXR(page, '&fast');
  await frames(page, 30);
  const { samples } = await recordAfter(page, 'comfort');
  const flashes0 = samples[0].flashes;
  const first = samples.findIndex((s) => s.flashes > flashes0);
  expect(first, 'the space settling is announced').toBeGreaterThan(0);
  expect(samples.slice(0, first).some((s) => s.active > 0), 'it was gliding before').toBe(true);
  expect(samples[first].active, 'and it was announced at rest').toBe(0);
  expect(errors).toEqual([]);
});

test('reduced motion and a flat screen place at once', async ({ page }) => {
  const errors = await enterXR(page, '&fast');
  await frames(page, 30);
  await page.evaluate(() => (window as Win).__access.set('reducedMotion', true));
  const { before, samples } = await recordAfter(page, 'comfort', 1.4, 10);
  const jump = profile(before, samples);
  expect(jump.total).toBeGreaterThan(0.08);
  expect(distance(samples[0], jump.end), 'with less motion asked for, the first frame is already there').toBeLessThan(1e-9);
  expect(samples[0].active).toBe(0);
  expect(errors).toEqual([]);
});

test('on a flat screen nothing glides', async ({ page }) => {
  const errors = await openWorkspace(page, '?fast');
  await page.waitForFunction(() => (window as Win).__glide != null);
  const { before, samples } = await recordAfter(page, 'comfort', 1.4, 10);
  expect(profile(before, samples).total).toBeGreaterThan(0.05);
  expect(samples[0].active).toBe(0);
  expect(distance(samples[0], samples[samples.length - 1])).toBeLessThan(1e-9);
  expect(errors).toEqual([]);
});

test('a panel that is sliding takes no pointer: a fingertip it runs into presses nothing, and it is given back at rest', async ({ page }) => {
  const errors = await enterXR(page, '&fast');
  await frames(page, 30);
  // The ancestors of a card, from its element up to the scene: a gliding board has "none" on one of them.
  const blocked = () =>
    page.evaluate(() => {
      const w = window as Win;
      let element: any = null;
      w.__world.scene.traverse((o: any) => {
        if (o.name === 'b1:card-0-0') element = o;
      });
      for (let o = element; o; o = o.parent) if (o.pointerEvents === 'none') return true;
      return false;
    });
  expect(await blocked()).toBe(false);
  await page.evaluate(() => {
    const a = (window as Win).__workspace.state.anchor;
    (window as Win).__workspace.dispatch({ op: 'set_comfort', reach: 1.4 }, { label: 'glide test', viewer: { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: 0 } });
  });
  await frames(page, 6);
  expect(await page.evaluate(() => (window as Win).__glide.active()), 'it is sliding').toBeGreaterThan(0);
  expect(await blocked(), 'and takes no pointer meanwhile').toBe(true);
  await settled(page);
  expect(await blocked(), 'given back once it has arrived').toBe(false);
  expect(errors).toEqual([]);
});

test('a board taken away while it slides leaves nothing behind and breaks nothing', async ({ page }) => {
  const errors = await enterXR(page, '&fast');
  await frames(page, 30);
  await page.evaluate(() => {
    const ws = (window as Win).__workspace;
    const a = ws.state.anchor;
    ws.dispatch({ op: 'create_board', title: 'Short lived', cards: [{ title: 'x' }] });
    ws.dispatch({ op: 'set_comfort', reach: 1.4 }, { label: 'glide test', viewer: { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: 0 } });
  });
  await frames(page, 6);
  expect(await page.evaluate(() => (window as Win).__glide.active())).toBeGreaterThan(0);
  await page.evaluate(() => {
    const ws = (window as Win).__workspace;
    ws.dispatch({ op: 'delete_board', board: ws.state.boards.find((b: any) => b.title === 'Short lived').id });
  });
  await settled(page);
  expect(await page.evaluate(() => (window as Win).__workspace.state.boards.some((b: any) => b.title === 'Short lived'))).toBe(false);
  expect(await page.evaluate(() => (window as Win).__glide.active())).toBe(0);
  expect(errors).toEqual([]);
});
