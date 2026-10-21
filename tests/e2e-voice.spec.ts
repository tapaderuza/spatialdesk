/**
 * Voice end to end with the real Amazon Transcribe: Chromium's fake microphone plays a spoken command (synthesised
 * with Piper: tests/fixtures/plan-my-day.wav, silence around it), the command server presigns the stream, Transcribe
 * hears it, and the words reach the agent as a plan to review.
 * Local: `E2E=1 npx playwright test tests/e2e-voice.spec.ts` with the jar running (the developer's AWS credentials).
 * Production: `E2E_URL=https://<cloudfront> npx playwright test tests/e2e-voice.spec.ts`.
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { openWorkspace, tap, type Win } from './helpers.js';

const target = process.env.E2E_URL;
const speech = resolve('tests/fixtures/plan-my-day.wav');

test.use({
  ...(target ? { baseURL: target } : {}),
  launchOptions: {
    args: [
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--use-angle=d3d11',
      '--enable-unsafe-swiftshader',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${speech}%noloop`,
    ],
  },
});

test('voice: a spoken "plan my day" reaches the agent through Amazon Transcribe', async ({ page }) => {
  test.skip(!process.env.E2E && !target, 'end-to-end only (E2E=1 or E2E_URL)');
  const errors = await openWorkspace(page);
  await page.waitForFunction(() => (window as Win).__link?.kind === 'online', null, { timeout: 60_000 });

  const started = Date.now();
  await tap(page, 'command:talk-button');
  await page.waitForFunction(() => (window as Win).__heard != null || (window as Win).__notice?.error, null, { timeout: 30_000 });
  const heard = await page.evaluate(() => (window as Win).__heard);
  console.log('E2E VOICE', JSON.stringify({ ms: Date.now() - started, heard, notice: await page.evaluate(() => (window as Win).__notice) }));
  expect(heard?.said).toMatch(/quarterly report/i);
  expect(heard?.said).toMatch(/dentist/i);
  expect(heard.command.kind).toBe('plan');

  await page.waitForFunction(() => ['preview', 'error'].includes((window as Win).__agent.state.phase), null, { timeout: 20_000 });
  const plan = await page.evaluate(() => (window as Win).__agent.state.plan);
  expect(plan?.ok, plan?.error).toBe(true);
  expect(errors).toEqual([]);
});
