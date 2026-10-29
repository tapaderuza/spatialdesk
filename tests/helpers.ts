import type { Page } from '@playwright/test';

export type Win = Window & Record<string, any>;

/** Opens the app and waits until the first board's cards are laid out. Returns the page errors seen. */
export async function openWorkspace(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e.message).split(String.fromCharCode(10)).slice(0, 8).join(' | ')));
  await page.goto(`/${query}`);
  await page.waitForFunction(() => {
    const w = (window as Win).__world;
    let ready = false;
    w?.scene.traverse((o: any) => {
      if (o.name === 'b1:card-0-0' && o.size?.value?.[0] > 0) ready = true;
    });
    return ready;
  }, null, { timeout: 60_000 });
  return errors;
}

/** Screen position (CSS px) of a point on a named element; (u, v) in [-0.5, 0.5] across it. */
export async function screenPoint(page: Page, name: string, u = 0, v = 0): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ name, u, v }) => {
      const w = (window as Win).__world;
      let o: any = null;
      w.scene.traverse((c: any) => {
        if (c.name === name) o = c;
      });
      if (!o) throw new Error(`no element ${name}`);
      o.updateWorldMatrix(true, false); // UIKit computes element matrices lazily
      const p = new w.camera.position.constructor(u, v, 0).applyMatrix4(o.matrixWorld).project(w.camera);
      const rect = w.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    },
    { name, u, v },
  );
}

/** Opens the app with the IWER Quest 3 emulator and enters the immersive session, as the "Enter XR" button does. */
export async function enterXR(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e.message).split(String.fromCharCode(10)).slice(0, 8).join(' | ')));
  await page.goto(`/?emulate${query}`);
  await page.waitForFunction(() => (window as Win).__world && (window as Win).__xrDevice, null, { timeout: 60_000 });
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await frames(page, 20); // the first-frame re-anchor has run
  return errors;
}

/** Waits [n] rendered frames. */
export async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}

/**
 * Waits until no panel is still gliding to a new place (src/ui/glide.ts), then two frames more: a change the person or the
 * AI asked for slides in under a second, and a test that reads where a board is, or taps it, waits for it to arrive.
 */
export async function settled(page: Page, timeout = 8_000): Promise<void> {
  await frames(page, 3); // the console starts to slide a frame after the boards do
  await page.waitForFunction(() => (window as Win).__glide?.active() === 0, null, { timeout });
  await frames(page, 2);
}

/**
 * Turns the emulated headset to [yawDeg] (positive = left) and [pitchDeg] (positive = up), over [steps] frames so it
 * reads as a head movement on video.
 */
export async function turnHead(page: Page, yawDeg: number, pitchDeg = 0, steps = 1): Promise<void> {
  await page.evaluate(
    async ({ yawDeg, pitchDeg, steps }) => {
      const device = (window as Win).__xrDevice;
      const from = { yaw: device.__headYaw ?? 0, pitch: device.__headPitch ?? 0 };
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const ease = t * t * (3 - 2 * t);
        const yaw = ((from.yaw + (yawDeg - from.yaw) * ease) * Math.PI) / 180;
        const pitch = ((from.pitch + (pitchDeg - from.pitch) * ease) * Math.PI) / 180;
        const [sy, cy, sx, cx] = [Math.sin(yaw / 2), Math.cos(yaw / 2), Math.sin(pitch / 2), Math.cos(pitch / 2)];
        device.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx); // yaw, then pitch (YXZ)
        await new Promise(requestAnimationFrame);
      }
      device.__headYaw = yawDeg;
      device.__headPitch = pitchDeg;
    },
    { yawDeg, pitchDeg, steps },
  );
  await frames(page, 3);
}

/** Turns the emulated headset so the centre of the view rests on a point of a named element ((u, v) as in screenPoint). */
export async function lookAt(page: Page, name: string, u = 0, v = 0, steps = 1): Promise<void> {
  const { yaw, pitch } = await page.evaluate(
    ({ name, u, v }) => {
      const w = (window as Win).__world;
      let o: any = null;
      w.scene.traverse((c: any) => {
        if (c.name === name) o = c;
      });
      if (!o) throw new Error(`no element ${name}`);
      o.updateWorldMatrix(true, false);
      const V = w.camera.position.constructor;
      const target = new V(u, v, 0).applyMatrix4(o.matrixWorld);
      const eye = w.camera.getWorldPosition(new V());
      const d = target.sub(eye).normalize();
      return { yaw: (Math.atan2(-d.x, -d.z) * 180) / Math.PI, pitch: (Math.asin(d.y) * 180) / Math.PI };
    },
    { name, u, v },
  );
  await turnHead(page, yaw, pitch, steps);
}

/** Points a controller's ray at a named element and pulls the trigger (the ray sweeps on first, as a hand would). */
export async function pressXR(page: Page, name: string, hand: 'left' | 'right' = 'right', originZ = -0.25): Promise<void> {
  await page.evaluate(
    async ({ name, hand, originZ }) => {
      const w = (window as Win).__world;
      const device = (window as Win).__xrDevice;
      let element: any = null;
      w.scene.traverse((o: any) => {
        if (o.name === name) element = o;
      });
      if (!element) throw new Error(`no element ${name}`);
      const V = w.camera.position.constructor;
      const Q = w.camera.quaternion.constructor;
      // Where the control is NOW, every time it is asked: a panel that has just changed what it shows (a button shown, a
      // card opened) lays its buttons out a frame or two later, so a point taken once at the start can be where the button
      // was. That lost 8 presses in 25 on "No" right after the setup's reach step; a hand follows what it points at.
      const targetPoint = new V();
      const aimAt = () => {
        element.updateWorldMatrix(true, false);
        return targetPoint.set(0, 0, 0).applyMatrix4(element.matrixWorld);
      };
      const controller = device.controllers[hand];
      const from = new V(hand === 'right' ? 0.18 : -0.18, 1.3, originZ);
      const frames = (n: number) =>
        new Promise<void>((resolve) => {
          let left = n;
          const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        });
      const start = new V().copy(controller.position);
      for (let i = 1; i <= 12; i++) {
        const p = new V().lerpVectors(start, from, i / 12);
        const dir = new V().copy(aimAt()).sub(p).normalize();
        const q = new Q().setFromUnitVectors(new V(0, 0, -1), dir);
        controller.position.set(p.x, p.y, p.z);
        controller.quaternion.set(q.x, q.y, q.z, q.w);
        await frames(1);
      }
      for (let i = 0; i < 10; i++) {
        const dir = new V().copy(aimAt()).sub(controller.position).normalize();
        const q = new Q().setFromUnitVectors(new V(0, 0, -1), dir);
        controller.quaternion.set(q.x, q.y, q.z, q.w);
        await frames(1);
      }
      controller.updateButtonValue('trigger', 1);
      await frames(4);
      controller.updateButtonValue('trigger', 0);
      await frames(4);
    },
    { name, hand, originZ },
  );
}

/** A real pointer tap: the pointer moves onto the element first, as a hand or a mouse would. */
export async function tap(page: Page, name: string, u = 0, v = 0): Promise<void> {
  const { x, y } = await screenPoint(page, name, u, v);
  await page.mouse.move(x - 12, y - 8);
  await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Turns the emulated eyes (not the head) toward the centre of a named element (IWER's gaze is viewer-relative). */
export async function lookWithEyes(page: Page, name: string): Promise<void> {
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
    const target = new V(0, 0, 0).applyMatrix4(o.matrixWorld).applyMatrix4(w.camera.matrixWorld.clone().invert()).normalize();
    const q = new Q().setFromUnitVectors(new V(0, 0, -1), target);
    device.gaze.quaternion.set(q.x, q.y, q.z, q.w);
  }, name);
  await frames(page, 12); // the gaze filter settles and the dwell window agrees
}

/** A pinch of one emulated hand: closes, holds a few frames, opens. */
export async function pinch(page: Page, side: 'left' | 'right' = 'right'): Promise<void> {
  await page.evaluate((side) => (window as Win).__xrDevice.hands[side].updatePinchValue(1), side);
  await frames(page, 4);
  await page.evaluate((side) => (window as Win).__xrDevice.hands[side].updatePinchValue(0), side);
  await frames(page, 4);
}

/** Rests the emulated hands in the lap, rays toward the floor, so the eyes do the aiming. */
export async function restHands(page: Page): Promise<void> {
  await page.evaluate(() => {
    const device = (window as Win).__xrDevice;
    for (const [side, x] of [['left', -0.2], ['right', 0.2]] as const) {
      const hand = device.hands[side];
      hand.position.set(x, 0.95, -0.25);
      hand.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    }
  });
  await frames(page, 5);
}
