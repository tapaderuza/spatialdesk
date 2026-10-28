/**
 * Failsafes: no judge meets an endless "thinking". When the AI (Amazon Nova) or the voice (Amazon Transcribe) is slower
 * than 7 s, or the network fails, the state ends, one calm line says "Network issue. Switched to manual mode.", and the
 * cards keep working by hand. A server that answers with its own words (a spent quota) still gets its explanation.
 */
import { expect, test, type Page } from '@playwright/test';
import { decodeMessage, encodeMessage } from '../src/voice/eventstream.js';
import { openWorkspace, tap, type Win } from './helpers.js';

const MANUAL = 'Network issue. Switched to manual mode.';

// Listening asks for the microphone first: Chromium's fake one, as in tests/voice.spec.ts.
test.use({
  launchOptions: {
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

const session = (page: Page) => page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
const phase = (page: Page) => page.evaluate(() => (window as Win).__agent.state.phase as string);
const notice = (page: Page) => page.evaluate(() => (window as Win).__notice as { text: string; error: boolean });
const cardsIn = (page: Page, column: number) =>
  page.evaluate((c) => (window as Win).__workspace.state.boards[0].columns[c].cards.map((k: any) => k.title), column);

/** The cards are the user's own: pick one up and drop it in Done, with the same taps a pinch makes. */
async function moveByHand(page: Page): Promise<void> {
  const first = (await cardsIn(page, 0))[0];
  await tap(page, 'b1:card-0-0');
  await tap(page, 'b1:col-2', 0, -0.4); // the empty lower part of the Done column
  expect(await cardsIn(page, 2)).toContain(first);
  expect(await cardsIn(page, 0)).not.toContain(first);
}

test('an AI that never answers: after 7 s "thinking" ends, one calm line, and the cards move by hand', async ({ page }) => {
  test.setTimeout(60_000);
  await session(page);
  await page.route('**/api/agent/plan', () => new Promise(() => {})); // the request hangs for ever
  const errors = await openWorkspace(page);

  const pressed = Date.now();
  await tap(page, 'command:plan-button');
  expect(await phase(page)).toBe('thinking');
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'idle', null, { timeout: 15_000 });
  const waited = Date.now() - pressed;
  expect(waited, 'it gives up at the 7 s limit, neither before nor much after').toBeGreaterThan(6_500);
  expect(waited).toBeLessThan(10_500);

  expect(await notice(page)).toMatchObject({ text: MANUAL, error: false }); // calm, not an alarm
  expect(await page.evaluate(() => (window as Win).__workspace.state.boards.length)).toBe(2); // nothing changed
  await moveByHand(page);
  expect(errors).toEqual([]);
});

test('a gateway error ends "thinking" at once; a server that explains itself keeps its explanation', async ({ page }) => {
  await session(page);
  await page.route('**/api/agent/plan', (route) => route.fulfill({ status: 503, body: '<html>Service Unavailable</html>', contentType: 'text/html' }));
  const errors = await openWorkspace(page);

  await tap(page, 'command:plan-button');
  await page.waitForFunction(() => (window as Win).__notice?.text === 'Network issue. Switched to manual mode.', null, { timeout: 5_000 });
  expect(await phase(page)).toBe('idle');
  await moveByHand(page);

  // The server answered, with its own words: that is not a network problem, so the explanation stays on a card.
  await page.unroute('**/api/agent/plan');
  await page.route('**/api/agent/plan', (route) => route.fulfill({ status: 429, json: { ok: false, error: 'That is 20 plans this hour. Try again a little later.' } }));
  await tap(page, 'command:prioritise-button');
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'error', null, { timeout: 10_000 });
  expect(await page.evaluate(() => (window as Win).__agent.state.plan.error)).toContain('20 plans this hour');
  expect(errors).toEqual([]);
});

test('Spanish says it in Spanish', async ({ page }) => {
  await session(page);
  await page.route('**/api/agent/plan', (route) => route.abort('connectionrefused'));
  const errors = await openWorkspace(page, '?lang=es-ES');
  await tap(page, 'command:plan-button');
  await page.waitForFunction(() => (window as Win).__notice?.text === 'Problema de red. Modo manual activado.', null, { timeout: 5_000 });
  expect(await phase(page)).toBe('idle');
  expect(errors).toEqual([]);
});

test('the voice that never connects: Talk ends after 7 s with the same line, and Talk works again after', async ({ page }) => {
  test.setTimeout(60_000);
  await session(page);
  await page.route('**/api/voice/session', () => new Promise(() => {})); // the server never grants the Transcribe URL
  const errors = await openWorkspace(page);

  const pressed = Date.now();
  await tap(page, 'command:talk-button');
  await page.waitForFunction(() => (window as Win).__notice?.text === 'Network issue. Switched to manual mode.', null, { timeout: 15_000 });
  const waited = Date.now() - pressed;
  expect(waited).toBeGreaterThan(6_500);
  expect(waited).toBeLessThan(10_500);
  expect((await notice(page)).error).toBe(false);

  // Not stuck "listening": the next press starts a new listen (here it fails at once, a 502 from the gateway).
  await page.unroute('**/api/voice/session');
  await page.route('**/api/voice/session', (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }));
  await page.evaluate(() => { (window as Win).__notice = { text: '', error: false }; });
  await tap(page, 'command:talk-button');
  await page.waitForFunction(() => (window as Win).__notice?.text === 'Network issue. Switched to manual mode.', null, { timeout: 5_000 });
  await moveByHand(page);
  expect(errors).toEqual([]);
});

/** The stand-in Transcribe of tests/voice.spec.ts: a granted URL, and a socket the test controls. */
async function transcribeStandIn(page: Page, behave: (ws: import('@playwright/test').WebSocketRoute, frames: number) => void): Promise<void> {
  await page.route('**/api/voice/session', (route) =>
    route.fulfill({ json: { ok: true, url: 'wss://transcribestreaming.us-east-1.amazonaws.com:8443/stream-transcription-websocket?test=1', language: 'en-US', sampleRate: 16000 } }),
  );
  await page.routeWebSocket(/transcribestreaming/, (ws) => {
    let frames = 0;
    ws.onMessage((message) => {
      if (typeof message === 'string') return;
      try {
        if (decodeMessage(new Uint8Array(message).buffer).headers[':event-type'] === 'AudioEvent') behave(ws, ++frames);
      } catch {
        /* a damaged frame is not this test's business */
      }
    });
  });
}

test('Transcribe closes the stream under the speaker: the same calm line, not "I didn\'t catch that"', async ({ page }) => {
  await session(page);
  await transcribeStandIn(page, (ws, frames) => {
    if (frames === 4) ws.close(); // dropped mid-sentence, before any words came back
  });
  const errors = await openWorkspace(page);
  await tap(page, 'command:talk-button');
  await page.waitForFunction(() => (window as Win).__notice?.text === 'Network issue. Switched to manual mode.', null, { timeout: 12_000 });
  expect((await notice(page)).error).toBe(false);
  await moveByHand(page);
  expect(errors).toEqual([]);
});

test('Transcribe answers with an exception: the same calm line', async ({ page }) => {
  await session(page);
  await transcribeStandIn(page, (ws, frames) => {
    if (frames !== 3) return;
    ws.send(Buffer.from(encodeMessage({ ':message-type': 'exception', ':exception-type': 'LimitExceededException', ':content-type': 'application/json' }, new TextEncoder().encode('{"Message":"Too many streams"}'))));
  });
  const errors = await openWorkspace(page);
  await tap(page, 'command:talk-button');
  await page.waitForFunction(() => (window as Win).__notice?.text === 'Network issue. Switched to manual mode.', null, { timeout: 12_000 });
  expect(errors).toEqual([]);
});
