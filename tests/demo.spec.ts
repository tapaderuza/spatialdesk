/**
 * The end-to-end demo, under 3 minutes, played in the IWER Quest 3 emulator with the controller ray and the trigger,
 * as a judge would with a headset, and recorded as video for the submission.
 * Needs the command server (Bedrock): local `npm run server:run` + preview proxy, or E2E_URL=https://<cloudfront>.
 *   DEMO=1 npx playwright test tests/demo.spec.ts          (video in test-results/)
 *   node scripts/make-video.mjs                             (the narrated, captioned cut, paced by NARRATION)
 * The voice-over, one line per beat: docs/video/narration.json.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pressXR, turnHead, type Win } from './helpers.js';

const target = process.env.E2E_URL;
test.use({
  ...(target ? { baseURL: target } : {}),
  viewport: { width: 1280, height: 720 },
  video: { mode: 'on', size: { width: 1280, height: 720 } },
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

test('demo: plan my day, work, the agent reacts, explain and undo (< 3 min)', async ({ page }, testInfo) => {
  test.skip(!process.env.DEMO, 'demo only (DEMO=1)');
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

  await page.goto('/?emulate&fast'); // ?fast: timers run in seconds, as judges can use it
  await online(page);
  await page.evaluate(() => indexedDB.deleteDatabase('spatialdesk'));
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

  // 2. Into the workspace.
  await page.evaluate((fovy) => ((window as Win).__xrDevice.fovy = (fovy * Math.PI) / 180), FOVY_DEG);
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await turnHead(page, 0, HEAD_PITCH_DEG);
  await beat('enter');
  await pause(page, 3);

  // 3. The guided start is offered; skipped here (accessibility.spec.ts measures it).
  await beat('coach');
  await settle();
  await pressXR(page, 'coach:coach-skip');
  await pause(page, 1);

  // 4. Plan my day: the agent proposes, the user reviews, applies.
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

  // 5. Work by hand: pick a card, drop it in Doing.
  await beat('hands');
  await pressXR(page, `${today}:card-0-0`);
  await pause(page, 1);
  await pressXR(page, `${today}:col-1`);
  await pause(page, 2);

  // 6. The focus block ends (?fast: 25 seconds): chime, flash, and the agent suggests the next block on its own.
  await beat('timer');
  await page.waitForFunction((want) => (window as Win).__agent.state.phase === want, 'suggestion', { timeout: 60_000 });
  await beat('suggestion');
  await pause(page, 4);
  await beat('accept');
  await pressXR(page, 'agent:plan-apply');
  await pause(page, 3);

  // 7. What did the AI do? Every step with its reason, and an Undo for each.
  await beat('log');
  await command('log-button');
  await phase(page, 'log');
  await pause(page, 4);
  await beat('undo');
  await pressXR(page, 'agent:step-0-undo');
  await pause(page, 2);
  await settle();
  await pressXR(page, 'agent:plan-discard');
  await pause(page, 1);

  // 8. High contrast, one tap (and remembered).
  await beat('contrast');
  await command('contrast-button');
  await pause(page, 2);

  // 9. Bring everything to me.
  await beat('arrange');
  await command('arrange-button');
  await pause(page, 2);
  await settle();

  // Playwright saves the video there once the page closes.
  if (process.env.MARKERS) writeFileSync(process.env.MARKERS, JSON.stringify({ video: join(testInfo.outputDir, 'video.webm'), beats }, null, 2));
  const seconds = (Date.now() - started) / 1000;
  console.log(`DEMO ${seconds.toFixed(0)} s`);
  expect(seconds).toBeLessThan(narration ? 240 : 180); // narrated, the edit checks the final cut (< 180 s)
});
