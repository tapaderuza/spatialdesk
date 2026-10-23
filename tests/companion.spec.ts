/**
 * The focus companion (Agentic: the agent's presence in the space; a body double for minds that wander): it floats
 * beside the board you work on, wherever the board goes, and its mood follows the work without a word: idle, working
 * with you through a focus block (the time left shown round its middle), thinking while the agent plans, bright when
 * the agent has something for you, calm in a break.
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, frames, turnHead, type Win } from './helpers.js';

const view = (page: Page) => page.evaluate(() => ({ ...(window as Win).__companion.view }) as { mood: string; progress: number; visible: boolean });

/** The companion's position in the focus board's own frame (metres): +x is the board's right, +y its up. */
const besideBoard = (page: Page) =>
  page.evaluate(() => {
    const w = (window as Win).__world;
    const ws = (window as Win).__workspace.state;
    const p = ws.boards.find((b: any) => b.id === ws.focusBoardId).pose;
    let mesh: any = null;
    w.getSceneObject('focus-companion').traverse((o: any) => {
      if (!mesh && o.isMesh) mesh = o;
    });
    const d = [mesh.position.x - p.x, mesh.position.y - p.y, mesh.position.z - p.z];
    const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    return { right: d[0] * right[0] + d[2] * right[2], up: d[1] };
  });

test('companion: beside the board wherever it goes, and its mood follows the work', async ({ page }) => {
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  let release: () => void = () => {};
  await page.route('**/api/agent/plan', async (route) => {
    await new Promise<void>((resolve) => (release = resolve)); // the agent "thinks" until the test lets it answer
    await route.fulfill({ json: { ok: true, summary: 'A short plan.', steps: [{ op: { op: 'start_timer', minutes: 5, label: 'Break' }, why: 'Rest' }], source: 'us.amazon.nova-2-lite-v1:0' } });
  });
  const errors = await enterXR(page, '&fast');
  expect((await view(page)).visible).toBe(true);
  expect((await view(page)).mood).toBe('idle');
  const at = await besideBoard(page);
  expect(at.right).toBeGreaterThan(0.36); // past the board's right edge
  expect(at.up).toBeGreaterThan(0);

  // A focus block: it works with you, and the time left shrinks round its middle.
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'start_timer', minutes: 25, label: 'Write the report' }));
  await frames(page, 5);
  const first = await view(page);
  expect(first.mood).toBe('focus');
  await page.waitForTimeout(2000);
  const later = await view(page);
  expect(later.progress).toBeLessThan(first.progress);
  expect(later.progress).toBeGreaterThan(0);

  // The agent thinking, then a plan to look at: the companion thinks, then turns to you.
  await page.evaluate(() => (window as Win).__voice.say('plan my day'));
  await page.waitForFunction(() => (window as Win).__companion.view.mood === 'thinking', null, { timeout: 5_000 });
  release();
  await page.waitForFunction(() => (window as Win).__companion.view.mood === 'speaking', null, { timeout: 5_000 });
  await page.evaluate(() => (window as Win).__agent.close());
  await frames(page, 3);
  expect((await view(page)).mood).toBe('focus');

  // A break is calm.
  const id = await page.evaluate(() => (window as Win).__workspace.state.timers[0].id as string);
  await page.evaluate((id) => (window as Win).__workspace.dispatch([{ op: 'dismiss_timer', timer: id }, { op: 'start_timer', minutes: 5, label: 'Break' }]), id);
  await frames(page, 3);
  expect((await view(page)).mood).toBe('break');

  // Wherever the board goes, it goes too.
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'arrange_space', layout: 'desk' }, { viewer: { x: 0.8, y: 1.3, z: 0.5, yaw: 1.2, pitch: 0 } }));
  const moved = await besideBoard(page);
  expect(moved.right).toBeCloseTo(at.right, 2);
  expect(errors).toEqual([]);
});

test('focus bubble: the world beyond arm\'s reach fades during a focus block, never in a break, and turns off by voice', async ({ page }) => {
  const errors = await enterXR(page, '&fast');
  const bubble = () =>
    page.evaluate(() => ({ ...(window as Win).__bubble.view }) as { strength: number; active: boolean; overlay: boolean; sceneLight: number });
  expect((await bubble()).active).toBe(false);
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'start_timer', minutes: 25, label: 'Write the report' }));
  await page.waitForFunction(() => (window as Win).__bubble.view.strength === 0.5, null, { timeout: 6_000 }); // eased in
  await frames(page, 2); // the environment system writes the dome's new intensity on its next frame
  // In VR night falls on the sky and the hills themselves: no overlay to fill (the room has one, room.spec).
  const vr = await bubble();
  expect(vr.overlay).toBe(false);
  expect(vr.sceneLight).toBeCloseTo(0.5, 2);
  const dome = await page.evaluate(() => {
    let found: any = null;
    (window as Win).__world.scene.traverse((o: any) => {
      if (o.userData?.iwsdkSceneDomeGradient) found = o;
    });
    return found ? found.material.uniforms.equatorColor.value.r : null;
  });
  expect(dome).toBeCloseTo(0.155 * 0.5, 3); // the dusk sky at half its light
  const id = await page.evaluate(() => (window as Win).__workspace.state.timers[0].id as string);
  await page.evaluate((id) => (window as Win).__workspace.dispatch([{ op: 'dismiss_timer', timer: id }, { op: 'start_timer', minutes: 5, label: 'Break' }]), id);
  await page.waitForFunction(() => (window as Win).__bubble.view.strength === 0, null, { timeout: 4_000 }); // a break: the world comes back
  expect((await bubble()).sceneLight).toBe(1);
  await page.evaluate(() => (window as Win).__voice.say('Dimming off'));
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'start_timer', minutes: 25, label: 'Write the report' }));
  await frames(page, 30);
  expect(await bubble()).toEqual({ strength: 0, active: false, overlay: false, sceneLight: 1 }); // the user turned it off: it stays off
  expect(await page.evaluate(() => (window as Win).__notice.text)).toContain('Focus dimming off');
  expect(errors).toEqual([]);
});

test('a wandering mind: look away during a focus block and the companion calls you back; looking back counts', async ({ page }) => {
  test.setTimeout(90_000);
  // The agent's own suggestion when the block ends never answers here, so the notice line stays the block's.
  await page.route('**/api/agent/plan', () => new Promise(() => {}));
  const errors = await enterXR(page, '&fast'); // ?fast: the companion calls after 3 s away instead of 45
  const wander = () => page.evaluate(() => ({ ...(window as Win).__wander.view }) as { watching: boolean; calling: boolean; returns: number });
  const focus = () => page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'start_timer', minutes: 25, label: 'Write the report' }));
  const awayFor = async (ms: number) => {
    await turnHead(page, 100, 0, 10); // out of the window
    await page.waitForTimeout(ms);
  };
  await focus();
  expect((await wander()).watching).toBe(true);

  // A glance at the timer beside the board is still the work.
  await turnHead(page, 25, 0, 10);
  await page.waitForTimeout(3_800);
  expect((await wander()).calling).toBe(false);

  // Looking away: the companion calls; looking back: it welcomes you, and the block counts it.
  await turnHead(page, 100, 0, 10);
  await page.waitForFunction(() => (window as Win).__wander.view.calling, null, { timeout: 6_000 });
  expect((await view(page)).mood).toBe('calling');
  await turnHead(page, 0, 0, 10);
  await page.waitForFunction(() => (window as Win).__wander.view.returns === 1, null, { timeout: 3_000 });
  expect((await wander()).calling).toBe(false);
  expect((await view(page)).mood).toBe('focus');

  // A break is not work: looking away calls nothing.
  const id = await page.evaluate(() => (window as Win).__workspace.state.timers[0].id as string);
  await page.evaluate((id) => (window as Win).__workspace.dispatch([{ op: 'dismiss_timer', timer: id }, { op: 'start_timer', minutes: 5, label: 'Break' }]), id);
  await awayFor(4_000);
  expect(await wander()).toEqual({ watching: false, calling: false, returns: 0 });

  // "Nudges off": the user decides; nothing calls.
  await turnHead(page, 0, 0, 10);
  await page.evaluate(() => (window as Win).__voice.say('Nudges off'));
  expect(await page.evaluate(() => (window as Win).__notice.text)).toContain('Nudges off');
  const breakId = await page.evaluate(() => (window as Win).__workspace.state.timers[0].id as string);
  await page.evaluate((id) => (window as Win).__workspace.dispatch({ op: 'dismiss_timer', timer: id }), breakId);
  await focus();
  await awayFor(4_000);
  expect((await wander()).calling).toBe(false);

  // On again: one wander, one comeback, and the block says so when it ends.
  await turnHead(page, 0, 0, 10);
  await page.evaluate(() => (window as Win).__voice.say('Nudges on'));
  await turnHead(page, 100, 0, 10);
  await page.waitForFunction(() => (window as Win).__wander.view.calling, null, { timeout: 6_000 });
  await turnHead(page, 0, 0, 10);
  await page.waitForFunction(() => (window as Win).__wander.view.returns === 1, null, { timeout: 3_000 });
  await page.waitForFunction(() => /You came back to it once/.test((window as Win).__notice.text), null, { timeout: 30_000 });
  expect(errors).toEqual([]);
});
