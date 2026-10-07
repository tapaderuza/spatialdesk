/**
 * The end-to-end demo (week 4 milestone), under 3 minutes, played in the IWER Quest 3 emulator with the controller
 * ray and the trigger, exactly as a judge would with a headset, and recorded as video for the submission.
 * Needs the command server (Bedrock): local `npm run server:run` + preview proxy, or E2E_URL=https://<cloudfront>.
 *   DEMO=1 npx playwright test tests/demo.spec.ts          (video in test-results/)
 * Narration and timings: docs/DEMO_SCRIPT.md.
 */
import { expect, test, type Page } from '@playwright/test';

const target = process.env.E2E_URL;
test.use({
  ...(target ? { baseURL: target } : {}),
  viewport: { width: 1280, height: 720 },
  video: { mode: 'on', size: { width: 1280, height: 720 } },
});

type Win = Window & Record<string, any>;

/** Points a controller's ray at a named element and pulls the trigger (hover first, as a hand would). */
async function press(page: Page, name: string, hand: 'left' | 'right' = 'right'): Promise<void> {
  await page.evaluate(
    async ({ name, hand }) => {
      const w = (window as Win).__world;
      const device = (window as Win).__xrDevice;
      let element: any = null;
      w.scene.traverse((o: any) => {
        if (o.name === name) element = o;
      });
      if (!element) throw new Error(`no element ${name}`);
      element.updateWorldMatrix(true, false);
      const V = w.camera.position.constructor;
      const Q = w.camera.quaternion.constructor;
      const targetPoint = new V(0, 0, 0).applyMatrix4(element.matrixWorld);
      const controller = device.controllers[hand];
      const from = new V(hand === 'right' ? 0.18 : -0.18, 1.3, -0.25);
      const frames = (n: number) =>
        new Promise<void>((resolve) => {
          let left = n;
          const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        });
      // Sweep the ray onto the target over a few frames, so hover shows on video.
      const start = new V().copy(controller.position);
      for (let i = 1; i <= 12; i++) {
        const p = new V().lerpVectors(start, from, i / 12);
        const dir = new V().copy(targetPoint).sub(p).normalize();
        const q = new Q().setFromUnitVectors(new V(0, 0, -1), dir);
        controller.position.set(p.x, p.y, p.z);
        controller.quaternion.set(q.x, q.y, q.z, q.w);
        await frames(1);
      }
      await frames(10);
      controller.updateButtonValue('trigger', 1);
      await frames(4);
      controller.updateButtonValue('trigger', 0);
      await frames(4);
    },
    { name, hand },
  );
}

const pause = (page: Page, seconds: number) => page.waitForTimeout(seconds * 1000);
const phase = (page: Page, p: string) => page.waitForFunction((want) => (window as Win).__agent.state.phase === want, p, { timeout: 30_000 });

test('demo: plan my day, work, the agent reacts, explain and undo (< 3 min)', async ({ page }) => {
  test.skip(!process.env.DEMO, 'demo only (DEMO=1)');
  test.setTimeout(240_000);
  const started = Date.now();
  await page.goto('/?emulate');
  await page.waitForFunction(() => (window as Win).__link?.kind === 'online' && (window as Win).__agent, null, { timeout: 60_000 });
  await page.evaluate(() => indexedDB.deleteDatabase('spatialdesk'));
  await page.reload();
  await page.waitForFunction(() => (window as Win).__link?.kind === 'online' && (window as Win).__agent, null, { timeout: 60_000 });
  await pause(page, 2);

  // 1. Describe the day in the browser, before putting the headset on.
  await page.locator('#day-text').fill('');
  await page.locator('#day-text').pressSequentially(
    'Finish the quarterly report, review two pull requests, call the dentist and prepare slides for Friday. Gym at 18:00.',
    { delay: 25 },
  );
  await pause(page, 1.5);

  // 2. Into the workspace.
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await pause(page, 3);

  // 3. Plan my day: the agent proposes, the user reviews, applies.
  await press(page, 'command:plan-button', 'left');
  await phase(page, 'preview');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan?.source)).toContain('nova'); // the AI, not the fallback
  await pause(page, 5);
  await press(page, 'agent:plan-apply');
  await pause(page, 4);
  const today = await page.evaluate(() => (window as Win).__workspace.state.focusBoardId as string);
  expect(today).toBeTruthy();

  // 4. Work by hand: pick a card, drop it in Doing.
  await press(page, `${today}:card-0-0`);
  await pause(page, 1);
  await press(page, `${today}:col-1`);
  await pause(page, 3);

  // 5. A focus block ends (shortened for the demo): chime, flash, and the agent suggests the next block on its own.
  await page.evaluate(() => {
    const ws = (window as Win).__workspace;
    const timer = ws.state.timers[0];
    if (timer) ws.dispatch({ op: 'dismiss_timer', timer: timer.id }, { undoable: false });
    const doing = ws.state.boards.find((b: any) => b.id === ws.state.focusBoardId).columns[1].cards[0];
    ws.dispatch({ op: 'start_timer', minutes: 0.1, card: doing.id }, { undoable: false });
  });
  await phase(page, 'suggestion');
  await pause(page, 5);
  await press(page, 'agent:plan-apply');
  await pause(page, 3);

  // 6. What did the AI do? Every step with its reason, and an Undo for each.
  await press(page, 'command:log-button', 'left');
  await phase(page, 'log');
  await pause(page, 5);
  await press(page, 'agent:step-0-undo');
  await pause(page, 3);
  await press(page, 'agent:plan-discard');
  await pause(page, 2);

  // 7. Bring everything to me.
  await press(page, 'command:arrange-button', 'left');
  await pause(page, 3);

  const seconds = (Date.now() - started) / 1000;
  console.log(`DEMO ${seconds.toFixed(0)} s`);
  expect(seconds).toBeLessThan(180);
});
