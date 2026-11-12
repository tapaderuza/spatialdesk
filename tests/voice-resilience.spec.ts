/**
 * Talk never hangs (src/voice/listen.ts). A microphone question nobody answers, as can happen inside an immersive session
 * on Quest Browser, used to hold the button on "Stop" for ever; an audio setup the browser refuses used to reject the listen
 * with nothing to catch it, with the same result. Both now end in one plain line, the label back on "Talk", and the next
 * press starting a new listen. The browser is stubbed here (getUserMedia, AudioContext): emulator results, not a headset.
 */
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { enterXR, openWorkspace, pressXR, tap, type Win } from './helpers.js';

const SILENT = 'The microphone did not answer. Allow it for this site, then press Talk again.';
const UNAVAILABLE = 'Voice is unavailable on this browser.';
const TRANSCRIBE_URL = 'wss://transcribestreaming.us-east-1.amazonaws.com:8443/stream-transcription-websocket?test=1';

const sessions = (page: Page) => page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
const hello = (ws: WebSocketRoute) => {
  ws.onMessage(() => {});
  ws.send(JSON.stringify({ type: 'hello', sessionId: 'x', serverTimeMs: Date.now(), protocol: 1 }));
};
// The guided start's "You are set" can land on the notice line between a press and the check: not this spec's.
const onboarded = (page: Page) => page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
const online = (page: Page) => page.waitForFunction(() => (window as Win).__link?.kind === 'online', null, { timeout: 45_000 });
const notice = (page: Page) => page.evaluate(() => (window as Win).__notice?.text as string | undefined);

/** What the Talk button shows now. Its label is a container (src/panel.ts sets "Stop" on it) whose child Text draws the words. */
const talkLabel = (page: Page) =>
  page.evaluate(() => {
    let label: any = null;
    (window as Win).__world.scene.traverse((o: any) => {
      if (o.name === 'command:talk-label') label = o;
    });
    let shown: unknown;
    label?.traverse((o: any) => {
      if (o !== label && typeof o.properties?.value?.text === 'string') shown = o.properties.value.text;
    });
    return (shown ?? label?.properties?.value?.text) as string | undefined;
  });
const labelIs = (page: Page, text: string, timeout: number) => expect.poll(() => talkLabel(page), { timeout, intervals: [100] }).toBe(text);

test('a microphone prompt that never answers in VR: Talk is back within 10 s and says what to do, a late microphone is switched off, and Stop does not wait', async ({ page }) => {
  await sessions(page);
  await page.routeWebSocket('**/ws?*', hello);
  await onboarded(page);
  // The question is asked and never answered; the test can answer it later, as a person might after the wait has ended.
  await page.addInitScript(() => {
    const w = window as Win;
    w.__micAsked = 0;
    w.__micAnswers = [];
    navigator.mediaDevices.getUserMedia = () => {
      w.__micAsked++;
      return new Promise<MediaStream>((resolve) => w.__micAnswers.push(resolve));
    };
  });
  const errors = await enterXR(page);
  await online(page);

  await pressXR(page, 'command:talk-button');
  await labelIs(page, 'Stop', 3_000);
  const listening = Date.now();
  await labelIs(page, 'Talk', 12_000);
  const waited = Date.now() - listening;
  expect(waited, 'it waits for an answer a person could still give').toBeGreaterThan(7_000);
  expect(waited, 'and no longer than about 10 s').toBeLessThan(10_000);
  expect(await notice(page)).toBe(SILENT);

  // Allowed after the wait has ended: that stream is closed at once, so the microphone light goes off.
  const late = await page.evaluate(async () => {
    const stream = new AudioContext().createMediaStreamDestination().stream;
    (window as Win).__micAnswers[0](stream);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return stream.getTracks().map((track) => track.readyState);
  });
  expect(late).toEqual(['ended']);

  // Not stuck: the next press listens again, and Stop ends the wait at once instead of after the microphone's 8 s.
  await pressXR(page, 'command:talk-button');
  await labelIs(page, 'Stop', 3_000);
  const again = Date.now();
  await pressXR(page, 'command:talk-button');
  await labelIs(page, 'Talk', 4_000);
  expect(Date.now() - again, 'Stop answered by itself, not by the timer').toBeLessThan(5_000);
  expect(await notice(page)).toBe('Stopped.');
  expect(await page.evaluate(() => (window as Win).__micAsked)).toBe(2);
  expect(errors).toEqual([]);
});

test('an AudioContext this browser refuses: Talk is back with "Voice is unavailable on this browser." and the microphone is released', async ({ page }) => {
  await sessions(page);
  await page.routeWebSocket('**/ws?*', hello);
  await onboarded(page);
  let granted = 0;
  await page.route('**/api/voice/session', (route) => {
    granted++;
    return route.fulfill({ json: { ok: true, url: TRANSCRIBE_URL, language: 'en-US', sampleRate: 16000 } });
  });
  let sockets = 0;
  await page.routeWebSocket(/transcribestreaming/, (ws) => {
    sockets++;
    void ws.close();
  });
  await page.addInitScript(() => {
    const w = window as Win;
    const Real = window.AudioContext;
    // Only the voice's 16 kHz context is refused (some browsers do not take that rate): the app's sounds keep theirs.
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        if (options?.sampleRate === 16_000) throw new DOMException('The sample rate is not supported.', 'NotSupportedError');
        super(options);
      }
    };
    w.__micTracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = new Real().createMediaStreamDestination().stream; // a live audio track, no device needed
      w.__micTracks.push(...stream.getTracks());
      return stream;
    };
  });
  const errors = await openWorkspace(page);
  await online(page);

  await tap(page, 'command:talk-button');
  await page.waitForFunction((text) => (window as Win).__notice?.text === text, UNAVAILABLE, { timeout: 8_000 });
  await labelIs(page, 'Talk', 2_000);
  expect(granted, 'it got as far as the server\'s grant').toBe(1);
  expect(sockets, 'and failed before any socket').toBe(0);
  expect(await page.evaluate(() => ((window as Win).__micTracks as MediaStreamTrack[]).map((track) => track.readyState))).toEqual(['ended']);

  // The next press starts a new listen rather than "Already listening.".
  await page.evaluate(() => {
    (window as Win).__notice = { text: '', error: false };
  });
  await tap(page, 'command:talk-button');
  await page.waitForFunction((text) => (window as Win).__notice?.text === text, UNAVAILABLE, { timeout: 8_000 });
  await labelIs(page, 'Talk', 2_000);
  expect(granted).toBe(2);
  expect(errors, 'no rejection left uncaught').toEqual([]);
});
