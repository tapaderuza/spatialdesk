/**
 * The end-to-end demo, under 3 minutes, played in the IWER Quest 3 emulator with the controller ray and the trigger,
 * as a judge would with a headset, and recorded as video for the submission. The story is accessibility: a real
 * person's request in her own voice and language ("my neck hurts, I'm tired: bring everything closer, on the right,
 * and the text bigger") reshapes the space, then her day, hands-free, a session she chooses, the AI log and her room.
 * Needs the command server (Bedrock, Transcribe): local `npm run server:run` + preview proxy, or E2E_URL=https://<cloudfront>.
 *   DEMO=1 npx playwright test tests/demo.spec.ts          (video in test-results/)
 *   node scripts/make-video.mjs                             (the narrated, captioned cut, paced by NARRATION)
 * The voice-over, one line per beat: docs/video/narration.json. MIC (a WAV, written by make-video.mjs from the "say"
 * beat) is played into the browser's microphone, so the Talk beat is heard by the real Amazon Transcribe.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markerColour } from '../scripts/video-contract.mjs';
import { frames, lookAt, pressXR, restHands, tap, turnHead, type Win } from './helpers.js';

// The whole file is the recording: skipped before any page (and its video, which needs ffmpeg) is created.
test.skip(!process.env.DEMO, 'demo only (DEMO=1)');

const target = process.env.E2E_URL;
const mic = process.env.MIC;
test.use({
  ...(target ? { baseURL: target } : {}),
  viewport: { width: 1280, height: 720 },
  video: { mode: 'on', size: { width: 1280, height: 720 } },
  launchOptions: {
    args: [
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--use-angle=d3d11',
      '--enable-unsafe-swiftshader',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      ...(mic ? [`--use-file-for-fake-audio-capture=${mic}%noloop`] : []),
    ],
  },
});

/** Seconds each narrated line lasts (written by scripts/make-video.mjs); without it the demo keeps its own pace. */
const narration: Record<string, number> | null = process.env.NARRATION ? JSON.parse(readFileSync(process.env.NARRATION, 'utf-8')) : null;
const GAP_MS = 350; // between lines
/** Framing for video: at the emulator's default 90° vertical field of view a 16:9 frame is 121° wide and boards look small. */
const FOVY_DEG = 90; // native emulator view: the whole review card and its controls remain in frame
const HEAD_PITCH_DEG = -6;
/** A glance toward the console before tapping it, as a seated user does: half its angle, within a small neck turn. */
const GLANCE_MAX_DEG = 26;
/** Her day, written on the page before the headset goes on (the Plan my day beat plans it). */
const DAY = 'Call the doctor at 10:00, pay the electricity bill, write to my sister and order the shopping for Friday.';

const pause = (page: Page, seconds: number) => page.waitForTimeout(seconds * 1000);
/** Keep the ray origin behind the nearby, enlarged panels; rest inactive inputs between clicks. */
const demoPress = async (page: Page, name: string, hand: 'left' | 'right' = 'right') => {
  await restHands(page);
  await pressXR(page, name, hand, name.startsWith('agent:') ? 0.2 : 0);
  await page.evaluate(() => {
    const device = (window as Win).__xrDevice;
    for (const side of ['left', 'right'] as const) {
      const controller = device.controllers[side];
      controller.updateButtonValue('trigger', 0);
      controller.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    }
  });
  await frames(page, 6);
};
const phase = async (page: Page, p: string) => {
  try {
    await page.waitForFunction((want) => {
      const state = (window as Win).__agent.state;
      if (state.phase === 'error') throw new Error(`Agent rejected the request: ${JSON.stringify(state.plan)}`);
      return state.phase === want;
    }, p, { timeout: 30_000 });
  } catch (cause) {
    const state = await page.evaluate(() => ({ agent: (window as Win).__agent.state, heard: (window as Win).__heard }));
    throw new Error(`Expected agent phase ${p}; observed ${JSON.stringify(state)}`, { cause });
  }
};
const online = (page: Page) =>
  page.waitForFunction(() => (window as Win).__link?.kind === 'online' && (window as Win).__agent, null, { timeout: 60_000 });
/** The console's yaw from the user's anchor, in degrees (+ is left): it moves with the body's comfort. */
const consoleYaw = (page: Page) =>
  page.evaluate(() => {
    const a = (window as Win).__workspace.state.anchor;
    const p = (window as Win).__world.getSceneObject('command-panel').position;
    let y = Math.atan2(-(p.x - a.x), -(p.z - a.z)) - a.yaw;
    while (y > Math.PI) y -= 2 * Math.PI;
    while (y < -Math.PI) y += 2 * Math.PI;
    return (y * 180) / Math.PI;
  });

test('demo: her companion adapts the space, remembers her choice, supports her day and returns to her setup (< 3 min)', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const started = Date.now(); // the video starts with the page, a moment before this
  const beats: { id: string; at: number }[] = [];
  const sync = async (colour: number[] | null) => page.evaluate((colour) => {
    let dot = document.getElementById('demo-frame-sync');
    if (!dot) {
      dot = document.createElement('div');
      dot.id = 'demo-frame-sync';
      dot.style.cssText = 'position:fixed;left:4px;top:4px;width:24px;height:24px;pointer-events:none;z-index:2147483647';
      document.body.append(dot);
    }
    dot.style.display = colour ? 'block' : 'none';
    if (colour) dot.style.backgroundColor = `rgb(${colour.join(',')})`;
  }, colour);
  let speakingUntil = 0;
  /** Waits until the line being spoken has finished. */
  const settle = async () => {
    const wait = speakingUntil + GAP_MS - Date.now();
    if (narration && wait > 0) await page.waitForTimeout(wait);
  };
  /** Starts a narrated beat once the previous line is over, and notes when (the edit lays the voice there). */
  const beat = async (id: string) => {
    if (!narration) return;
    if (!(id in narration)) throw new Error(`docs/video/narration.json has no line "${id}"`);
    await settle();
    beats.push({ id, at: Date.now() - started });
    await sync(markerColour(beats.length - 1));
    console.log(`DEMO beat: ${id}`);
    speakingUntil = Date.now() + narration[id] * 1000;
  };
  /** Glances toward the console (wherever the body's comfort put it) and taps one of its buttons with that side's hand. */
  const command = async (button: string) => {
    const yaw = await consoleYaw(page);
    await turnHead(page, Math.max(-GLANCE_MAX_DEG, Math.min(GLANCE_MAX_DEG, yaw / 2)), HEAD_PITCH_DEG, 14);
    await demoPress(page, `command:${button}`, yaw > 0 ? 'left' : 'right');
    await turnHead(page, 0, HEAD_PITCH_DEG, 14);
  };

  // ?fast: timers in seconds; the room is used in the room beat; ?lang=es-ES: Transcribe listens for her Spanish.
  await page.goto('/?emulate&fast&room=home_office&lang=es-ES');
  await online(page);
  await page.evaluate(() => {
    indexedDB.deleteDatabase('spatialdesk');
    // A few earlier days of use, so the command panel's streak and seven-day strip show what they are for.
    const key = (n: number) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const day = (blocks: number, minutes: number, done: number) => ({ blocks, minutes, done });
    localStorage.setItem('spatialdesk.progress', JSON.stringify({ days: { [key(1)]: day(3, 75, 4), [key(2)]: day(2, 50, 3), [key(3)]: day(4, 100, 6), [key(5)]: day(1, 25, 2) } }));
    localStorage.removeItem('spatialdesk.settings');
    localStorage.removeItem('spatialdesk.comfort-memory');
  });
  await page.reload();
  await online(page);
  await page.locator('#day-text').fill(DAY); // before the first beat: the edit starts there

  // 1. Into the workspace as designed: the console to the left, boards out at the sides. The guided start is offered
  // and skipped (accessibility.spec.ts measures it).
  await page.evaluate((fovy) => ((window as Win).__xrDevice.fovy = (fovy * Math.PI) / 180), FOVY_DEG);
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await turnHead(page, 0, HEAD_PITCH_DEG);
  await demoPress(page, 'coach:coach-skip');
  await beat('enter');
  await pause(page, 1.5);
  await turnHead(page, 40, HEAD_PITCH_DEG, 24); // what a turn of the head costs: the console...
  await pause(page, 0.8);
  await turnHead(page, -45, HEAD_PITCH_DEG, 30); // ...and the boards at the sides
  await pause(page, 0.8);
  await turnHead(page, 0, HEAD_PITCH_DEG, 20);
  await settle();

  // 2. Her request, in her voice: the microphone plays it; the real Transcribe hears Spanish; the agent adapts the space.
  await beat('talk');
  await settle();
  const yaw = await consoleYaw(page);
  await turnHead(page, Math.min(GLANCE_MAX_DEG, yaw / 2), HEAD_PITCH_DEG, 14);
  await demoPress(page, 'command:talk-button', 'left');
  await beat('say');
  await page.waitForFunction(() => (window as Win).__heard != null, null, { timeout: 40_000 });
  const heard = await page.evaluate(() => (window as Win).__heard);
  expect(heard.said).toMatch(/cuello/i);
  await turnHead(page, 0, HEAD_PITCH_DEG, 14);
  await phase(page, 'preview');
  const comfort = await page.evaluate(() => (window as Win).__agent.state.plan);
  expect(comfort.source).toContain('nova'); // the AI, not the fallback
  expect(comfort.steps.length).toBeGreaterThan(0);
  for (const step of comfort.steps) expect(step.op.op).toBe('set_comfort');
  await beat('heard');
  await pause(page, 3);
  await settle();
  await beat('apply');
  await demoPress(page, 'agent:plan-apply');
  await frames(page, 10);
  expect(await consoleYaw(page)).toBeLessThan(0); // the console came to her right hand
  await pause(page, 2.5);
  await turnHead(page, Math.max(-GLANCE_MAX_DEG, (await consoleYaw(page)) / 2), HEAD_PITCH_DEG, 18); // her console, a small turn away
  await pause(page, 1.5);
  await turnHead(page, 0, HEAD_PITCH_DEG, 18);
  await settle();

  await beat('dialogue');
  const initialReach = await page.evaluate(() => (window as Win).__workspace.state.comfort.reach);
  await page.evaluate(() => (window as Win).__voice.say('Un poco más lejos, por favor.'));
  await phase(page, 'preview');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan?.source)).toContain('nova');
  expect(await page.evaluate((reach) => (window as Win).__agent.state.plan?.steps.some((s: any) => s.op.op === 'set_comfort' && s.op.reach > reach), initialReach)).toBe(true);
  await pause(page, 1.5);
  await demoPress(page, 'agent:plan-apply');
  await settle();
  await beat('saved');
  await command('memory-button');
  await phase(page, 'memory');
  await pause(page, 1);
  await pressXR(page, 'agent:plan-reply', 'right', 0.2);
  await page.waitForFunction(() => !!localStorage.getItem('spatialdesk.comfort-memory'));
  await pause(page, 2);
  await settle();
  await demoPress(page, 'agent:plan-discard');

  // 3. Her day: the agent plans it, she reviews, applies.
  await beat('plan');
  await command('plan-button');
  await phase(page, 'preview');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan?.source)).toContain('nova');
  await pause(page, 2);
  await settle();
  await demoPress(page, 'agent:plan-apply');
  await pause(page, 2.5);

  // 4. Hands-free: on with a tap, then the gaze alone brings everything to her and turns it off again.
  await beat('handsfree');
  await command('handsfree-button');
  await lookAt(page, 'command:arrange-button', 0, 0, 16);
  await page.waitForFunction(() => (window as Win).__gaze.presses >= 1, null, { timeout: 5_000 });
  await pause(page, 1.5);
  await lookAt(page, 'command:handsfree-button', 0, 0, 12);
  await page.waitForFunction(() => (window as Win).__gaze.presses >= 2, null, { timeout: 5_000 });
  await turnHead(page, 0, HEAD_PITCH_DEG, 14);
  await settle();

  // 4b. Other ways in: steady aim for a hand that shakes, then one switch: the buttons light up in turn and a trigger
  // (aimed anywhere) chooses the one lit, here Bring to me. Both off again for the rest of the story.
  await beat('switch');
  await lookAt(page, 'command:arrange-button', 0, 0, 14); // the whole console in view, so the scan's frame is seen
  await page.evaluate(() => (window as Win).__voice.say('tremor mode on'));
  await pause(page, 1.2);
  await page.evaluate(() => (window as Win).__access.set('scanIntervalMs', 800)); // brisk for the video
  await page.evaluate(() => (window as Win).__voice.say('switch mode on'));
  await page.waitForFunction(() => (window as Win).__switch.view.surface === 'command', null, { timeout: 5_000 });
  const arrangedBefore = await page.evaluate(() => (window as Win).__workspace.state.revision as number);
  await demoPress(page, 'command:plan-button'); // the switch: where the ray points does not matter
  await page.waitForFunction(() => (window as Win).__switch.view.highlighted === 'arrange', null, { timeout: 20_000 });
  await demoPress(page, 'command:plan-button');
  await page.waitForFunction((r) => (window as Win).__workspace.state.revision > r, arrangedBefore, { timeout: 5_000 });
  expect(await page.evaluate(() => (window as Win).__agent.state.phase)).toBe('idle'); // Plan my day was not pressed
  await pause(page, 1);
  await page.evaluate(() => (window as Win).__voice.say('switch mode off'));
  await page.evaluate(() => (window as Win).__voice.say('tremor mode off'));
  await turnHead(page, 0, HEAD_PITCH_DEG, 14);
  await settle();

  // 4c. Fit to my reach: lying back, her right hand reaches a little nearer and higher than the board sits now, and
  // pinches. The card proposes what the hand measured (nearer, 12 degrees higher); Apply brings the space there.
  await beat('reach');
  const comfortBefore = await page.evaluate(() => ({ ...(window as Win).__workspace.state.comfort }));
  await page.evaluate(() => (window as Win).__voice.say('ponlo a mi alcance'));
  expect(await page.evaluate(() => (window as Win).__reach.view.measuring)).toBe(true);
  await page.evaluate(async () => {
    const w = (window as Win).__world;
    const a = (window as Win).__workspace.state.anchor;
    const c = (window as Win).__workspace.state.comfort;
    const controller = (window as Win).__xrDevice.controllers.right;
    const V = w.camera.position.constructor;
    const Q = w.camera.quaternion.constructor;
    // Where the board sits now (Layout's focus slot: 0.643 m at 15.3 degrees down, times reach, turned by tilt),
    // 10% nearer and 12 degrees higher, 20 degrees to her right.
    const distance = c.reach * Math.hypot(0.62, 0.17) * 0.9;
    const up = ((-15.3 + c.tiltDeg + 12) * Math.PI) / 180;
    const bearing = (20 * Math.PI) / 180;
    const right = distance * Math.cos(up) * Math.sin(bearing);
    const ahead = distance * Math.cos(up) * Math.cos(bearing);
    const to = new V(a.x + right * Math.cos(a.yaw) - ahead * Math.sin(a.yaw), a.y + distance * Math.sin(up), a.z - right * Math.sin(a.yaw) - ahead * Math.cos(a.yaw));
    const from = new V().copy(controller.position);
    const aim = new V().copy(to).sub(w.camera.getWorldPosition(new V())).normalize();
    const q = new Q().setFromUnitVectors(new V(0, 0, -1), aim);
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const p = new V().lerpVectors(from, to, t * t * (3 - 2 * t)); // eased, as an arm moves
      controller.position.set(p.x, p.y, p.z);
      controller.quaternion.set(q.x, q.y, q.z, q.w);
      await new Promise(requestAnimationFrame);
    }
  });
  await pause(page, 0.6);
  await page.evaluate(() => (window as Win).__xrDevice.controllers.right.updateButtonValue('trigger', 1));
  await frames(page, 4);
  await page.evaluate(() => (window as Win).__xrDevice.controllers.right.updateButtonValue('trigger', 0));
  await page.waitForFunction(() => !(window as Win).__reach.view.measuring, null, { timeout: 3_000 });
  await phase(page, 'preview');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan?.source)).toBe('reach');
  await pause(page, 2.5);
  await demoPress(page, 'agent:plan-apply');
  await page.waitForFunction((before) => (window as Win).__workspace.state.comfort.tiltDeg > before.tiltDeg, comfortBefore, { timeout: 5_000 });
  await pause(page, 1.5);
  await settle();

  // 5. One session at her pace. Clear the earlier demo timer before choosing a new block.
  await page.evaluate(() => {
    for (const t of (window as Win).__workspace.state.timers) (window as Win).__workspace.dispatch({ op: 'dismiss_timer', timer: t.id });
  });
  const doneBefore = await page.evaluate(() => (window as Win).__workspace.state.boards.flatMap((b: any) => b.columns.at(-1).cards.map((c: any) => c.id)));
  await beat('session');
  await command('session-button');
  await phase(page, 'session');
  await demoPress(page, 'agent:session-15');
  await demoPress(page, 'agent:energy-low');
  await pause(page, 1.5);
  await demoPress(page, 'agent:plan-reply');
  await phase(page, 'preview');
  const session = await page.evaluate(() => (window as Win).__agent.state.plan);
  expect(session.source).toContain('nova');
  const timers = session.steps.filter((s: any) => s.op.op === 'start_timer');
  expect(timers).toHaveLength(1);
  expect(timers[0].op.minutes).toBeLessThanOrEqual(5);
  await pause(page, 1.5);
  await demoPress(page, 'agent:plan-apply');
  const sessionTimer = await page.evaluate(() => (window as Win).__workspace.state.timers.find((t: any) => t.state === 'running' && /^Session: /.test(t.label)));
  expect(sessionTimer).toBeTruthy();

  // A voluntary interruption: the user's next action is saved locally and the same clock is paused.
  await beat('pause');
  await page.evaluate(() => (window as Win).__voice.say('Necesito parar'));
  await phase(page, 'resume');
  const nextStep = /bill|factura/i.test(sessionTimer.label) ? 'comprobar el importe de la factura' : 'revisar el primer detalle de esta tarea';
  await page.evaluate((text) => (window as Win).__voice.say(`Cuando vuelva, ${text}`), nextStep);
  await pause(page, 0.5);
  await demoPress(page, 'agent:plan-reply');
  const frozen = await page.evaluate((id) => (window as Win).__workspace.state.timers.find((t: any) => t.id === id), sessionTimer.id);
  expect(frozen.state).toBe('paused');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.resume-note')!).nextStep)).toBe(nextStep);
  await settle();
  expect(await page.evaluate((id) => (window as Win).__workspace.state.timers.find((t: any) => t.id === id).remainingMs, sessionTimer.id)).toBe(frozen.remainingMs);

  await sync(null); // the page-loading gap is excluded by the frame calibration
  await page.evaluate(() => { (window as Win).__agent.close(); (window as Win).__workspace.flush(); });
  await pause(page, 0.5);
  await page.reload();
  await online(page);
  await page.evaluate((fovy) => { (window as Win).__xrDevice.fovy = fovy * Math.PI / 180; (window as Win).__world.launchXR(); }, FOVY_DEG);
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible');
  await turnHead(page, 0, HEAD_PITCH_DEG);
  await page.evaluate(() => (window as Win).__voice.say('Por dónde iba'));
  await phase(page, 'resume');
  await beat('return');
  await pause(page, 1.5);
  await demoPress(page, 'agent:plan-apply');
  await phase(page, 'preview');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan?.source)).toBe('saved-work');
  expect(await page.evaluate((id) => (window as Win).__workspace.state.timers.find((t: any) => t.id === id).state, sessionTimer.id)).toBe('paused');
  await settle();
  await demoPress(page, 'agent:plan-apply');
  await page.waitForFunction(() => (window as Win).__agent.state.plan?.source === 'session-clock', null, { timeout: 20_000 });
  expect(await page.evaluate((id) => (window as Win).__workspace.state.timers.find((t: any) => t.id === id).state, sessionTimer.id)).toBe('done');
  expect(await page.evaluate(() => (window as Win).__workspace.state.boards.flatMap((b: any) => b.columns.at(-1).cards.map((c: any) => c.id)))).toEqual(doneBefore);
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.some((t: any) => t.state === 'running'))).toBe(false);
  await settle();
  await beat('session-end');
  await pause(page, 3);
  await settle();
  await demoPress(page, 'agent:plan-discard');

  // 7. What did the AI do? Every step with its reason, and an Undo for each.
  await beat('log');
  await command('log-button');
  await phase(page, 'log');
  await pause(page, 3);
  await settle();
  await demoPress(page, 'agent:plan-discard');
  await pause(page, 0.5);

  // Another visit after trying the default layout. The bookmark is restored locally, with review and Undo.
  await sync(null); // preparation and page loading are outside the edited story
  await page.evaluate(() => (window as Win).__voice.say('back to normal'));
  await phase(page, 'preview');
  await demoPress(page, 'agent:plan-apply');
  await page.evaluate(() => { (window as Win).__agent.close(); (window as Win).__workspace.flush(); });
  await pause(page, 0.5);
  await page.reload();
  await online(page);
  await page.evaluate((fovy) => { (window as Win).__xrDevice.fovy = fovy * Math.PI / 180; (window as Win).__world.launchXR(); }, FOVY_DEG);
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible');
  await turnHead(page, 0, HEAD_PITCH_DEG);
  await page.evaluate(() => (window as Win).__voice.say('recupera mi ajuste'));
  await phase(page, 'preview');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan?.source)).toBe('saved-setup');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan?.steps.length)).toBeGreaterThan(0);
  await beat('recall');
  await pause(page, 2);
  await demoPress(page, 'agent:plan-apply');
  await page.waitForFunction(() => (window as Win).__workspace.state.comfort.side === 'right');
  await pause(page, 1.5);
  await settle();
  await demoPress(page, 'agent:plan-discard');

  // 8. In her room: passthrough in IWER's home office, seated at the desk; Fit room uses the detected desk and walls,
  // and a focus block lets the room recede.
  await beat('room');
  await page.evaluate(() => (window as Win).__world.exitXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'non-immersive' && !(window as Win).__world.session);
  await page.evaluate(() => (window as Win).__xrDevice.position.set(0, 1.2, -1.2));
  await turnHead(page, 0, 0);
  await frames(page, 20);
  await tap(page, 'command:room-button');
  await page.waitForFunction(() => (window as Win).__room?.state.inRoom && (window as Win).__room.queries.planes.entities.size >= 8, null, { timeout: 30_000 });
  await turnHead(page, 0, HEAD_PITCH_DEG);
  await pause(page, 1.5);
  await command('fit-button');
  await page.waitForFunction(() => (window as Win).__room.state.lastFit?.desk === true, null, { timeout: 5_000 });
  await turnHead(page, 0, -10, 14);
  await pause(page, 2);
  await page.evaluate(() => (window as Win).__voice.say('focus'));
  await page.waitForFunction(() => (window as Win).__bubble.view.strength > 0.6, null, { timeout: 8_000 });
  await turnHead(page, 38, -4, 20);
  await pause(page, 1.5);
  await turnHead(page, 0, HEAD_PITCH_DEG, 20);
  await settle();

  // Playwright saves the video there once the page closes.
  await sync(null);
  if (process.env.MARKERS) writeFileSync(process.env.MARKERS, JSON.stringify({ video: join(testInfo.outputDir, 'video.webm'), beats }, null, 2));
  const seconds = (Date.now() - started) / 1000;
  console.log(`DEMO ${seconds.toFixed(0)} s`);
  expect(seconds).toBeLessThan(narration ? 240 : 180); // narrated, the edit checks the final cut (< 180 s)
});
