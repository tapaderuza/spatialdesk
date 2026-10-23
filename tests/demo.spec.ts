/**
 * The end-to-end demo, under 3 minutes, played in the IWER Quest 3 emulator with the controller ray and the trigger,
 * as a judge would with a headset, and recorded as video for the submission.
 * Needs the command server (Bedrock, Transcribe): local `npm run server:run` + preview proxy, or E2E_URL=https://<cloudfront>.
 *   DEMO=1 npx playwright test tests/demo.spec.ts          (video in test-results/)
 *   node scripts/make-video.mjs                             (the narrated, captioned cut, paced by NARRATION)
 * The voice-over, one line per beat: docs/video/narration.json. MIC (a WAV, written by make-video.mjs from the "say"
 * line) is played into the browser's microphone, so the Talk beat is heard by the real Amazon Transcribe.
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
const GLANCE_DEG = 26; // toward the command panel before tapping it, as a seated user does

const pause = (page: Page, seconds: number) => page.waitForTimeout(seconds * 1000);
const phase = (page: Page, p: string) => page.waitForFunction((want) => (window as Win).__agent.state.phase === want, p, { timeout: 30_000 });
const online = (page: Page) =>
  page.waitForFunction(() => (window as Win).__link?.kind === 'online' && (window as Win).__agent, null, { timeout: 60_000 });

test('demo: plan my day, work, talk, the agent reacts, explain and undo, hands-free, wrap up, room, glasses (< 3 min)', async ({ page }, testInfo) => {
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
  /** Glances at the command panel and taps one of its buttons. */
  const command = async (button: string) => {
    await turnHead(page, GLANCE_DEG, HEAD_PITCH_DEG, 14);
    await pressXR(page, `command:${button}`, 'left');
    await turnHead(page, 0, HEAD_PITCH_DEG, 14);
  };

  await page.goto('/?emulate&fast&room=home_office'); // ?fast: timers in seconds; the room is used in beat 10
  await online(page);
  await page.evaluate(() => {
    indexedDB.deleteDatabase('spatialdesk');
    // A few earlier days of use, so the streak and the seven-day strip show what they are for. No last visit: the
    // start-of-day suggestion is covered by tests/progress.spec.ts, not this story.
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
  await pause(page, 1);

  // 1. Describe the day in the browser, before putting the headset on.
  await beat('describe');
  await page.locator('#day-text').fill('');
  await page.locator('#day-text').pressSequentially(
    'Finish the quarterly report, review two pull requests, call the dentist and prepare slides for Friday. Gym at 18:00.',
    { delay: 25 },
  );
  await pause(page, 1.5);
  await settle();

  // 2. Into the workspace. The guided start is offered and skipped (accessibility.spec.ts measures it).
  await page.evaluate((fovy) => ((window as Win).__xrDevice.fovy = (fovy * Math.PI) / 180), FOVY_DEG);
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await turnHead(page, 0, HEAD_PITCH_DEG);
  await beat('enter');
  await pause(page, 2);
  await pressXR(page, 'coach:coach-skip');
  await pause(page, 1);

  // 3. Plan my day: the agent proposes, the user reviews, applies.
  await beat('plan');
  await command('plan-button');
  await phase(page, 'preview');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan?.source)).toContain('nova'); // the AI, not the fallback
  await pause(page, 2);
  await beat('preview');
  await pause(page, 3);
  await beat('apply');
  await pressXR(page, 'agent:plan-apply');
  await pause(page, 3);
  const today = await page.evaluate(() => (window as Win).__workspace.state.focusBoardId as string);
  expect(today).toBeTruthy();

  // 4. Work by hand: pick a card, drop it in Doing.
  await beat('hands');
  await pressXR(page, `${today}:card-0-0`);
  await pause(page, 1);
  await pressXR(page, `${today}:col-1`);
  await pause(page, 2);

  // 5. The focus block ends (?fast: 25 seconds): chime, flash, the plant on the desk grows a leaf, and the agent
  // suggests the next block on its own.
  await beat('timer');
  const growth = await page.evaluate(() => (window as Win).__studio.state.growth as number);
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.some((t: any) => t.state === 'done'), null, { timeout: 40_000 });
  await turnHead(page, -30, -24, 16); // the plant, right of the board on the desk
  await page.waitForFunction((g) => (window as Win).__studio.state.growth >= g + 1, growth, { timeout: 10_000 });
  await pause(page, 1);
  await turnHead(page, 0, HEAD_PITCH_DEG, 14);
  await phase(page, 'suggestion');
  await beat('suggestion');
  await pause(page, 3);
  await settle();
  await pressXR(page, 'agent:plan-discard'); // "Not now": no break timer to ring over what comes next
  await pause(page, 1);

  // 6. Talk: the line is played into the microphone; the real Transcribe hears it and the agent plans it.
  await beat('talk');
  await settle();
  await turnHead(page, GLANCE_DEG, HEAD_PITCH_DEG, 14);
  await pressXR(page, 'command:talk-button', 'left');
  await beat('say');
  await page.waitForFunction(() => (window as Win).__heard != null, null, { timeout: 30_000 });
  const heard = await page.evaluate(() => (window as Win).__heard);
  expect(heard.said).toMatch(/dentist/i);
  await turnHead(page, 0, HEAD_PITCH_DEG, 14);
  await phase(page, 'preview');
  await beat('heard');
  await pause(page, 3);
  await pressXR(page, 'agent:plan-apply');
  await pause(page, 2);

  // 7. What did the AI do? Every step with its reason, and an Undo for each.
  await beat('log');
  await command('log-button');
  await phase(page, 'log');
  await pause(page, 3);
  await pressXR(page, 'agent:step-0-undo');
  await pause(page, 2);
  await settle();
  await pressXR(page, 'agent:plan-discard');
  await pause(page, 1);

  // 8. Hands-free: on with a tap, then the gaze alone brings everything back and turns it off again.
  await beat('handsfree');
  await command('handsfree-button');
  await lookAt(page, 'command:arrange-button', 0, 0, 16);
  await page.waitForFunction(() => (window as Win).__gaze.presses >= 1, null, { timeout: 5_000 });
  await pause(page, 1.5);
  await lookAt(page, 'command:handsfree-button', 0, 0, 12);
  await page.waitForFunction(() => (window as Win).__gaze.presses >= 2, null, { timeout: 5_000 });
  await pause(page, 1);

  // 9. Progress: today's block, the streak and the last seven days, at the top of the command panel.
  await beat('streak');
  await lookAt(page, 'command:status-detail', 0, -1.5, 14);
  await pause(page, 5);
  await settle();

  // 10. The end of the day: the agent wraps it up, naming what got done and clearing it for tomorrow.
  await beat('wrapup');
  await command('wrap-button');
  await phase(page, 'preview');
  await pause(page, 4);
  await pressXR(page, 'agent:plan-apply');
  await pause(page, 1.5);
  await settle();

  // 11. In my room: passthrough in IWER's home office, seated at the desk; Fit room uses the detected desk and walls.
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
  await turnHead(page, 0, -12, 14);
  await pause(page, 3);
  await turnHead(page, 75, -2, 20);
  await pause(page, 2.5);
  await turnHead(page, 0, HEAD_PITCH_DEG, 20);
  await settle();

  // 12. Meta VR Glasses: the same workspace in IWER's glasses profile (its narrower view masked), fitted to the view
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
