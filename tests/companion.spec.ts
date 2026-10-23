/**
 * The focus companion (Agentic: the agent's presence in the space; a body double for minds that wander): it floats
 * beside the board you work on, wherever the board goes, and its mood follows the work without a word: idle, working
 * with you through a focus block (the time left shown round its middle), thinking while the agent plans, bright when
 * the agent has something for you, calm in a break.
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, frames, type Win } from './helpers.js';

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
  const bubble = () => page.evaluate(() => ({ ...(window as Win).__bubble.view }) as { strength: number; active: boolean });
  expect((await bubble()).active).toBe(false);
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'start_timer', minutes: 25, label: 'Write the report' }));
  await page.waitForFunction(() => (window as Win).__bubble.view.strength >= 0.49, null, { timeout: 6_000 }); // eased in
  const id = await page.evaluate(() => (window as Win).__workspace.state.timers[0].id as string);
  await page.evaluate((id) => (window as Win).__workspace.dispatch([{ op: 'dismiss_timer', timer: id }, { op: 'start_timer', minutes: 5, label: 'Break' }]), id);
  await page.waitForFunction(() => (window as Win).__bubble.view.strength === 0, null, { timeout: 4_000 }); // a break: the world comes back
  await page.evaluate(() => (window as Win).__voice.say('Dimming off'));
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'start_timer', minutes: 25, label: 'Write the report' }));
  await frames(page, 30);
  expect(await bubble()).toEqual({ strength: 0, active: false }); // the user turned it off: it stays off
  expect(await page.evaluate(() => (window as Win).__notice.text)).toContain('Focus dimming off');
  expect(errors).toEqual([]);
});
