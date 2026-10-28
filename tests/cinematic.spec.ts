/**
 * The recording mode (`?cinematicMode=true`, src/cinematic/cinematic.ts), with the camera mocked (an animated canvas
 * stream), so no test machine needs a webcam:
 *  - the webcam's picture fills the room behind the panels, in the app's passthrough mode, and the page shows nothing
 *    but the canvas, with no cursor;
 *  - the head follows the mouse on a spring: it starts gently, never overshoots, and arrives;
 *  - a click selects what the view rests on, and P makes the right hand push it;
 *  - a refused camera films the VR studio instead, and nothing of it loads without the parameter.
 */
import { expect, test, type Page } from '@playwright/test';
import { frames, type Win } from './helpers.js';

/** getUserMedia answered by an animated 1280 x 720 canvas, or refused. Counts the calls. */
const mockCamera = (page: Page, refuse = false) =>
  page.addInitScript((refuse) => {
    (window as any).__cameraCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__cameraCalls++;
      if (refuse) throw new DOMException('Permission denied', 'NotAllowedError');
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const g = canvas.getContext('2d')!;
      let t = 0;
      const draw = () => {
        g.fillStyle = `hsl(${(t * 2) % 360} 35% 40%)`;
        g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#eee';
        g.fillRect(100 + ((t * 6) % 1000), 300, 90, 90);
        t++;
        requestAnimationFrame(draw);
      };
      draw();
      return canvas.captureStream(30);
    };
  }, refuse);

async function startRecording(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  await page.goto('/?cinematicMode=true');
  await page.waitForSelector('#cinematic-start', { timeout: 60_000 });
  await page.click('#cinematic-start');
  await page.waitForFunction(() => (window as Win).__cinematic.state.started && (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await frames(page, 20);
  return errors;
}

/** Yaw and pitch (radians) that put a named element at the centre of the view. */
const angleTo = (page: Page, name: string) =>
  page.evaluate((name) => {
    const w = (window as Win).__world;
    let el: any = null;
    w.scene.traverse((o: any) => {
      if (o.name === name) el = o;
    });
    el.updateWorldMatrix(true, false);
    const V = w.camera.position.constructor;
    const d = new V().setFromMatrixPosition(el.matrixWorld).sub(w.camera.getWorldPosition(new V())).normalize();
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(d.y) };
  }, name);

test('recording mode: the webcam fills the room behind the panels, and the page is nothing but the canvas', async ({ page }) => {
  await mockCamera(page);
  const errors = await startRecording(page);
  const look = await page.evaluate(() => {
    const w = (window as Win).__world;
    const c = (window as Win).__cinematic;
    const backdrop = c.backdrop();
    const V = w.camera.position.constructor;
    const head = w.camera.getWorldPosition(new V());
    // Every element the page shows: the canvas and what holds it, nothing else.
    const shown = [...document.body.querySelectorAll('*')].filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.contains(w.renderer.domElement);
    });
    return {
      camera: c.state.camera,
      inRoom: (window as Win).__room.state.inRoom,
      backdrop: backdrop ? { visible: backdrop.visible, gap: backdrop.position.distanceTo(head), playing: !backdrop.material.map.image.paused } : null,
      shown: shown.map((e) => e.tagName + (e.id ? `#${e.id}` : '')),
      cursor: getComputedStyle(w.renderer.domElement).cursor,
    };
  });
  expect(look.camera).toBe('on');
  expect(look.inRoom).toBe(true); // the app's passthrough mode: no virtual studio, shadows on
  expect(look.backdrop).toMatchObject({ visible: true, playing: true });
  expect(look.backdrop!.gap).toBeLessThan(0.05); // centred on the head
  expect(look.shown).toEqual([]);
  expect(look.cursor).toBe('none');
  expect(errors).toEqual([]);
});

test('recording mode: the head follows the mouse on a spring, starting gently, never overshooting, arriving', async ({ page }) => {
  await mockCamera(page);
  const errors = await startRecording(page);
  await page.evaluate(() => (window as Win).__cinematic.look(400, 0)); // a quick flick: 400 px to the right
  const target = await page.evaluate(() => (window as Win).__cinematic.state.targetYaw as number);
  expect(target).toBeLessThan(-0.5);
  const samples: number[] = [];
  for (let i = 0; i < 40; i++) {
    await frames(page, 1);
    samples.push(await page.evaluate(() => (window as Win).__cinematic.state.yaw as number));
  }
  expect(samples[0] / target, 'the first frame moves only a little of the way').toBeLessThan(0.15);
  for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-9); // one way only
  expect(Math.min(...samples)).toBeGreaterThanOrEqual(target - 1e-6); // never past the target
  await page.waitForFunction((t) => Math.abs((window as Win).__cinematic.state.yaw - t) < 0.01, target, { timeout: 3_000 });
  // The emulated head really turned.
  const yaw = await page.evaluate(() => {
    const w = (window as Win).__world;
    const d = w.camera.getWorldDirection(new (w.camera.position.constructor)());
    return Math.atan2(-d.x, -d.z);
  });
  expect(Math.abs(yaw - target)).toBeLessThan(0.03);
  expect(errors).toEqual([]);
});

test('recording mode: a click selects what the view rests on, and P makes the right hand push it', async ({ page }) => {
  await mockCamera(page);
  const errors = await startRecording(page);
  // Look at a card and click: it is picked up.
  const card = await angleTo(page, 'b1:card-0-0');
  await page.evaluate(({ yaw, pitch }) => (window as Win).__cinematic.aim(yaw, pitch, true), card);
  await frames(page, 5);
  await page.evaluate(() => (window as Win).__cinematic.select());
  await page.waitForFunction(() => (window as Win).__notice?.text?.startsWith('Holding'), null, { timeout: 3_000 });
  await page.evaluate(() => (window as Win).__cinematic.select()); // and put back

  // Look at Focus 25 and press P: the hand comes up, pushes it once, and goes back down.
  const focus = await angleTo(page, 'command:focus-button');
  await page.evaluate(({ yaw, pitch }) => (window as Win).__cinematic.aim(yaw, pitch, true), focus);
  await frames(page, 5);
  const before = await page.evaluate(() => (window as Win).__poke.presses as number);
  const timers = () => page.evaluate(() => (window as Win).__workspace.state.timers.length as number);
  const timersBefore = await timers();
  await page.keyboard.press('p');
  await page.waitForFunction(() => (window as Win).__cinematic.state.pokes === 1, null, { timeout: 8_000 });
  const pressed = await page.evaluate(() => ({ presses: (window as Win).__poke.presses as number, log: [...(window as Win).__poke.log] }));
  expect(pressed.presses, JSON.stringify(pressed.log)).toBe(before + 1);
  const why = await page.evaluate(() => JSON.stringify({ log: (window as Win).__poke.log, timers: (window as Win).__workspace.state.timers.map((t: any) => `${t.label} ${t.card ?? ''}`), notice: (window as Win).__notice?.text }));
  expect(await timers(), why).toBe(timersBefore + 1); // Focus 25, once
  expect(errors).toEqual([]);
});

test('recording mode: a refused camera films the VR studio instead; without the parameter nothing of it loads', async ({ page }) => {
  await mockCamera(page, true);
  const errors = await startRecording(page);
  expect(await page.evaluate(() => (window as Win).__cinematic.state.camera)).toBe('refused');
  expect(await page.evaluate(() => (window as Win).__cinematic.backdrop())).toBeNull();
  expect(await page.evaluate(() => (window as Win).__room.state.inRoom)).toBe(false);
  expect(errors).toEqual([]);

  await page.goto('/?emulate');
  await page.waitForFunction(() => (window as Win).__world, null, { timeout: 60_000 });
  await frames(page, 10);
  expect(await page.evaluate(() => ({ start: !!document.getElementById('cinematic-start'), api: '__cinematic' in window, calls: (window as any).__cameraCalls }))).toEqual({
    start: false,
    api: false,
    calls: 0,
  });
});
