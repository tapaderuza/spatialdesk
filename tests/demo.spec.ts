/**
 * The end-to-end demo, under 3 minutes, played in the IWER Quest 3 emulator with the controller ray and the trigger,
 * as a judge would with a headset, and recorded as video for the submission. The story is accessibility: a real
 * person's request in her own voice and language ("my neck hurts, I'm tired: bring everything closer, on the right,
 * and the text bigger") reshapes the space, then her day, hands-free, a first step, the companion, the AI log, her
 * room and the glasses.
 * Needs the command server (Bedrock, Transcribe): local `npm run server:run` + preview proxy, or E2E_URL=https://<cloudfront>.
 *   DEMO=1 npx playwright test tests/demo.spec.ts          (video in test-results/)
 *   node scripts/make-video.mjs                             (the narrated, captioned cut, paced by NARRATION)
 * The voice-over, one line per beat: docs/video/narration.json. MIC (a WAV, written by make-video.mjs from the "say"
 * beat) is played into the browser's microphone, so the Talk beat is heard by the real Amazon Transcribe.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { frames, lookAt, lookWithEyes, pinch, pressXR, restHands, tap, turnHead, type Win } from './helpers.js';

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
const FOVY_DEG = 72;
const HEAD_PITCH_DEG = -6;
/** A glance toward the console before tapping it, as a seated user does: half its angle, within a small neck turn. */
const GLANCE_MAX_DEG = 26;
/** Her day, written on the page before the headset goes on (the Plan my day beat plans it). */
const DAY = 'Call the doctor at 10:00, pay the electricity bill, write to my sister and order the shopping for Friday.';

const pause = (page: Page, seconds: number) => page.waitForTimeout(seconds * 1000);
const phase = (page: Page, p: string) => page.waitForFunction((want) => (window as Win).__agent.state.phase === want, p, { timeout: 30_000 });
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

test('demo: her request reshapes the space, then her day, hands-free, start small, the companion, the AI log, her room, the glasses (< 3 min)', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const started = Date.now(); // the video starts with the page, a moment before this
  const beats: { id: string; at: number }[] = [];
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
    speakingUntil = Date.now() + narration[id] * 1000;
  };
  /** Glances toward the console (wherever the body's comfort put it) and taps one of its buttons with that side's hand. */
  const command = async (button: string) => {
    const yaw = await consoleYaw(page);
    await turnHead(page, Math.max(-GLANCE_MAX_DEG, Math.min(GLANCE_MAX_DEG, yaw / 2)), HEAD_PITCH_DEG, 14);
    await pressXR(page, `command:${button}`, yaw > 0 ? 'left' : 'right');
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
  await pressXR(page, 'coach:coach-skip');
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
  await pressXR(page, 'command:talk-button', 'left');
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
  await pressXR(page, 'agent:plan-apply');
  await frames(page, 10);
  expect(await consoleYaw(page)).toBeLessThan(0); // the console came to her right hand
  await pause(page, 2.5);
  await turnHead(page, Math.max(-GLANCE_MAX_DEG, (await consoleYaw(page)) / 2), HEAD_PITCH_DEG, 18); // her console, a small turn away
  await pause(page, 1.5);
  await turnHead(page, 0, HEAD_PITCH_DEG, 18);
  await settle();

  // 3. Her day: the agent plans it, she reviews, applies.
  await beat('plan');
  await command('plan-button');
  await phase(page, 'preview');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan?.source)).toContain('nova');
  await pause(page, 2);
  await settle();
  await beat('planned');
  await pressXR(page, 'agent:plan-apply');
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

  // 5. Start small: five minutes on the first bit (?fast: five seconds); when they end the plant grows a leaf and the
  // agent, told she has started, offers to keep going rather than a break.
  await beat('start');
  // A timer from her plan may be running: the first step gets its own block.
  await page.evaluate(() => {
    for (const t of (window as Win).__workspace.state.timers) (window as Win).__workspace.dispatch({ op: 'dismiss_timer', timer: t.id });
  });
  await command('start-button');
  await phase(page, 'preview');
  await pause(page, 1.5);
  await pressXR(page, 'agent:plan-apply');
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.some((t: any) => /^first step/i.test(t.label)), null, { timeout: 5_000 });
  const growth = await page.evaluate(() => (window as Win).__studio.state.growth as number);
  await page.waitForFunction((g) => (window as Win).__studio.state.growth >= g + 1, growth, { timeout: 20_000 });
  await phase(page, 'suggestion');
  await settle();
  await beat('momentum');
  await pause(page, 2.5);
  await pressXR(page, 'agent:plan-apply');
  await phase(page, 'idle');
  await settle();

  // 6. The companion: she looks away during the block, it calls her back; she looks back, it welcomes her.
  await beat('companion');
  await pause(page, 1);
  await turnHead(page, 70, 2, 18);
  await page.waitForFunction(() => (window as Win).__wander.view.calling, null, { timeout: 8_000 });
  await pause(page, 1);
  await turnHead(page, 0, HEAD_PITCH_DEG, 16);
  await page.waitForFunction(() => (window as Win).__wander.view.returns >= 1, null, { timeout: 4_000 });
  await pause(page, 1.5);
  await settle();

  // 7. What did the AI do? Every step with its reason, and an Undo for each.
  await beat('log');
  await command('log-button');
  await phase(page, 'log');
  await pause(page, 3);
  await settle();
  await pressXR(page, 'agent:plan-discard');
  await pause(page, 0.5);

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

  // 9. Meta VR Glasses: the same workspace in IWER's glasses profile (its narrower view masked), fitted to the view
  // the headset reports; the eyes aim and a pinch picks a card up and drops it.
  await beat('glasses');
  await page.evaluate(() => (window as Win).__world.exitXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'non-immersive' && !(window as Win).__world.session);
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'arrange_space', layout: 'desk' }, { viewer: { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 } }));
  await pause(page, 1); // the workspace is saved (debounced) before the page reloads as the glasses
  await page.goto('/?emulate&fast&glasses');
  await online(page);
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__workspace.state.view?.halfWidthDeg < 35, null, { timeout: 30_000 });
  await restHands(page);
  await turnHead(page, 0, -4);
  await pause(page, 2.5);
  const board = await page.evaluate(() => (window as Win).__workspace.state.focusBoardId as string);
  await lookWithEyes(page, board + ':card-0-0');
  await pause(page, 0.8);
  await pinch(page, 'right');
  await pause(page, 1.2);
  await lookWithEyes(page, board + ':col-1');
  await pause(page, 0.8);
  await pinch(page, 'left');
  await pause(page, 2);
  await settle();

  // Playwright saves the video there once the page closes.
  if (process.env.MARKERS) writeFileSync(process.env.MARKERS, JSON.stringify({ video: join(testInfo.outputDir, 'video.webm'), beats }, null, 2));
  const seconds = (Date.now() - started) / 1000;
  console.log(`DEMO ${seconds.toFixed(0)} s`);
  expect(seconds).toBeLessThan(narration ? 240 : 180); // narrated, the edit checks the final cut (< 180 s)
});
