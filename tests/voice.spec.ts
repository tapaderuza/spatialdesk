/**
 * Voice commands (Accessibility: a voice alternative to every hand interaction; Agentic: talking to the agent).
 * Offline, in CI: the command grammar and the AWS event stream framing as pure functions, then the whole capture
 * path in the browser (Chromium's fake microphone -> 16 kHz PCM -> event stream frames on a WebSocket) against a
 * stand-in for Amazon Transcribe, and every command acting on the workspace. tests/e2e.spec.ts covers the real
 * Transcribe against production.
 */
import { expect, test } from '@playwright/test';
import { parseCommand } from '../src/voice/commands.js';
import { audioEvent, crc32, decodeMessage, encodeMessage } from '../src/voice/eventstream.js';
import { openWorkspace, tap, type Win } from './helpers.js';

test.use({
  launchOptions: {
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('voice grammar: buttons by name, settings on and off, the day, and anything else for the agent', () => {
  expect(parseCommand('Focus.')).toEqual({ kind: 'focus' });
  expect(parseCommand('Yes, apply it.')).toEqual({ kind: 'apply' });
  expect(parseCommand('Not now')).toEqual({ kind: 'discard' });
  expect(parseCommand('Undo that, please')).toEqual({ kind: 'undo' });
  expect(parseCommand('Bring everything to me')).toEqual({ kind: 'arrange' });
  expect(parseCommand('What did you do?')).toEqual({ kind: 'log' });
  expect(parseCommand('Prioritize my tasks')).toEqual({ kind: 'prioritise' });
  expect(parseCommand('Turn high contrast on.')).toEqual({ kind: 'setting', setting: 'highContrast', value: true });
  expect(parseCommand('Hands-free off')).toEqual({ kind: 'setting', setting: 'handsFree', value: false });
  expect(parseCommand('Read aloud')).toEqual({ kind: 'setting', setting: 'readAloud', value: undefined });
  expect(parseCommand('Plan my day: finish the report, call the dentist and gym at 18:00.')).toEqual({
    kind: 'plan',
    text: 'finish the report, call the dentist and gym at 18:00.',
  });
  expect(parseCommand('Plan my day')).toEqual({ kind: 'plan', text: '' });
  expect(parseCommand('Planning is hard')).toEqual({ kind: 'ask', text: 'Planning is hard' });
  expect(parseCommand('Move the dentist call to the top and give me a short break')).toEqual({
    kind: 'ask',
    text: 'Move the dentist call to the top and give me a short break',
  });
  expect(parseCommand('Sí, vale')).toEqual({ kind: 'apply' });
  for (const said of ['Wrap up my day.', "I'm done for today", 'Call it a day, please', 'Cierra el día']) expect(parseCommand(said), said).toEqual({ kind: 'wrapup' });
  expect(parseCommand("Let's call it a day")).toEqual({ kind: 'ask', text: "Let's call it a day" }); // longer: the agent reads it
  expect(parseCommand('Close')).toEqual({ kind: 'discard' }); // "close" alone still closes the card
  expect(parseCommand('banana')).toBeNull(); // one unknown word: a mishearing, not a request
  expect(parseCommand('  ')).toBeNull();
});

test('event stream framing: CRC-32 check value, round trip, and damage is detected', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926); // the standard check value
  const payload = new Uint8Array([1, 2, 3, 250]);
  const frame = encodeMessage({ ':event-type': 'AudioEvent', ':message-type': 'event' }, payload);
  const back = decodeMessage(frame.slice().buffer);
  expect(back.headers).toEqual({ ':event-type': 'AudioEvent', ':message-type': 'event' });
  expect(Array.from(back.payload)).toEqual([1, 2, 3, 250]);
  const damaged = frame.slice();
  damaged[damaged.length - 6] ^= 0xff;
  expect(() => decodeMessage(damaged.buffer)).toThrow(/CRC/);
  expect(decodeMessage(audioEvent(new Uint8Array(0)).slice().buffer).payload.length).toBe(0); // end of audio
});

test('voice end to end in the browser: microphone to the agent through a stand-in Transcribe', async ({ page }) => {
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/voice/session', (route) =>
    route.fulfill({ json: { ok: true, url: 'wss://transcribestreaming.us-east-1.amazonaws.com:8443/stream-transcription-websocket?test=1', language: 'en-US', sampleRate: 16000 } }),
  );
  let planRequest: { intent: string; text?: string } | null = null;
  await page.route('**/api/agent/plan', async (route) => {
    planRequest = route.request().postDataJSON();
    await route.fulfill({
      json: { ok: true, summary: 'Two tasks.', steps: [{ op: { op: 'start_timer', minutes: 25, label: 'Report' }, why: 'Report first' }], source: 'us.amazon.nova-2-lite-v1:0' },
    });
  });
  const audio = { frames: 0, bytes: 0, ended: false, badFrames: 0 };
  await page.routeWebSocket(/transcribestreaming/, (ws) => {
    const transcript = (text: string, partial: boolean) =>
      ws.send(
        Buffer.from(
          encodeMessage(
            { ':event-type': 'TranscriptEvent', ':message-type': 'event', ':content-type': 'application/json' },
            new TextEncoder().encode(JSON.stringify({ Transcript: { Results: [{ ResultId: 'r1', IsPartial: partial, Alternatives: [{ Transcript: text }] }] } })),
          ),
        ),
      );
    ws.onMessage((message) => {
      if (typeof message === 'string') return;
      try {
        const frame = decodeMessage(new Uint8Array(message).buffer);
        if (frame.headers[':event-type'] !== 'AudioEvent') return;
        if (frame.payload.length === 0) {
          audio.ended = true;
          ws.close();
          return;
        }
        audio.frames++;
        audio.bytes += frame.payload.length;
        if (audio.frames === 5) transcript('Plan my day: finish', true);
        if (audio.frames === 8) transcript('Plan my day: finish the report and call the dentist.', false);
      } catch {
        audio.badFrames++;
      }
    });
  });

  const errors = await openWorkspace(page);
  await page.waitForFunction(() => (window as Win).__link?.kind === 'online' || (window as Win).__link?.kind === 'connecting');
  await tap(page, 'command:talk-button');
  await page.waitForFunction(() => (window as Win).__heard != null, null, { timeout: 15_000 });
  const heard = await page.evaluate(() => (window as Win).__heard);
  expect(heard.said).toBe('Plan my day: finish the report and call the dentist.');
  expect(heard.command).toEqual({ kind: 'plan', text: 'finish the report and call the dentist.' });
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  expect(planRequest).toMatchObject({ intent: 'plan_my_day', text: 'finish the report and call the dentist.' });
  expect(audio.badFrames).toBe(0);
  expect(audio.frames).toBeGreaterThanOrEqual(8);
  expect(audio.bytes % 2).toBe(0); // whole 16-bit samples
  expect(audio.ended).toBe(true); // the end-of-audio frame was sent
  expect(errors).toEqual([]);
});

test('voice commands act on the workspace: focus, undo, yes, no, settings', async ({ page }) => {
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/agent/plan', (route) =>
    route.fulfill({
      json: { ok: true, summary: 'A break.', steps: [{ op: { op: 'start_timer', minutes: 5, label: 'Break' }, why: 'Rest' }], source: 'us.amazon.nova-2-lite-v1:0' },
    }),
  );
  // The guided start's "You are set" can land on the notice line between a command and the check: not this test's.
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await openWorkspace(page);
  const say = (said: string) => page.evaluate((s) => (window as Win).__voice.say(s), said);
  const timers = () => page.evaluate(() => (window as Win).__workspace.state.timers.map((t: any) => t.label));

  await say('Focus');
  expect(await timers()).toHaveLength(1);
  await say('Undo');
  expect(await timers()).toHaveLength(0);

  await say('Give me a short break before the next block'); // anything else: the agent
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  await say('Yes');
  expect(await timers()).toEqual(['Break']);

  await say('Plan my day');
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  await say('No');
  expect(await page.evaluate(() => (window as Win).__agent.state.phase)).toBe('idle');

  await say('Turn high contrast on');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.settings') ?? '{}').highContrast)).toBe(true);
  await say('Banana');
  expect(await page.evaluate(() => (window as Win).__notice.text)).toContain("Say a button's name");
  expect(errors).toEqual([]);
});
