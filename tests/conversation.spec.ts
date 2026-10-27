import { expect, test, type Page, type Route } from '@playwright/test';
import { enterXR, frames, pressXR, type Win } from './helpers.js';
import { Conversation } from '../src/agent/conversation.js';
import { decodeMessage, encodeMessage } from '../src/voice/eventstream.js';

test.use({ launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });

const session = (page: Page) => page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
const say = (page: Page, words: string) => page.evaluate((words) => (window as Win).__voice.say(words), words);
const preview = (page: Page) => page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview');
const answer = (route: Route, summary: string, steps: unknown[] = []) => route.fulfill({ json: { ok: true, summary, steps, source: 'test-model' } });

test('dialogue memory is bounded, copies are isolated, and only proposals can be applied', () => {
  const c = new Conversation();
  for (let i = 0; i < 9; i++) c.remember({ user: `turn-${i}`, assistant: 'question', outcome: 'discussed' });
  expect(c.snapshot().map((t) => t.user)).toEqual(['turn-3', 'turn-4', 'turn-5', 'turn-6', 'turn-7', 'turn-8']);
  c.resolve('applied');
  expect(c.snapshot()[5].outcome).toBe('discussed');
  c.remember({ user: 'closer', assistant: 'propose', outcome: 'proposed' });
  const copy = c.snapshot();
  copy[5].outcome = 'discarded';
  expect(c.snapshot()[5].outcome).toBe('proposed');
  c.resolve('applied');
  c.resolve('discarded');
  expect(c.snapshot()[5].outcome).toBe('applied');
  c.clear();
  expect(c.snapshot()).toEqual([]);
});

test('conversation: a question, short reply, permission, feedback and forgetting through real controls', async ({ page }) => {
  await session(page);
  await page.route('**/api/voice/session', (route) => route.fulfill({ json: { ok: true, url: 'wss://transcribestreaming.us-east-1.amazonaws.com:8443/stream-transcription-websocket?test=1', language: 'es-ES', sampleRate: 16000 } }));
  let microphoneFrames = 0;
  await page.routeWebSocket(/transcribestreaming/, (ws) => {
    ws.onMessage((message) => {
      if (typeof message === 'string') return;
      const frame = decodeMessage(new Uint8Array(message).buffer);
      if (!frame.payload.length) { ws.close(); return; }
      if (++microphoneFrames !== 5) return;
      ws.send(Buffer.from(encodeMessage({ ':event-type': 'TranscriptEvent', ':message-type': 'event', ':content-type': 'application/json' }, new TextEncoder().encode(JSON.stringify({ Transcript: { Results: [{ ResultId: 'reply', IsPartial: false, Alternatives: [{ Transcript: 'sí' }] }] } })))));
    });
  });
  const asked: any[] = [];
  await page.route('**/api/agent/plan', async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    if (asked.length === 1) return answer(route, '¿Te gustaría acercar los paneles?');
    if (asked.length === 2) return answer(route, 'Puedo acercarlos un poco. Revisa el cambio antes de aplicarlo.', [
      { op: { op: 'set_comfort', reach: 0.8 }, why: 'Más cerca, como has pedido' },
    ]);
    return answer(route, '¿En qué puedo ayudarte ahora?');
  });
  const errors = await enterXR(page, '&lang=es-ES');
  const before = await page.evaluate(() => (window as Win).__workspace.state.comfort);
  await say(page, 'Necesito ayuda para estar cómoda');
  await preview(page);
  expect(asked[0].intent).toBe('companion');
  expect(asked[0].conversation).toEqual([]);
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort)).toEqual(before);

  await pressXR(page, 'agent:plan-reply', 'right', 0); // the real Reply control opens microphone capture
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(2);
  await preview(page);
  expect(microphoneFrames).toBeGreaterThanOrEqual(5);
  expect(asked[1].text).toBe('sí');
  expect(asked[1].conversation).toEqual([{ user: asked[0].text, assistant: '¿Te gustaría acercar los paneles?', outcome: 'discussed' }]);
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort)).toEqual(before);
  await pressXR(page, 'agent:plan-apply', 'right', 0);
  await page.waitForFunction(() => (window as Win).__workspace.state.comfort.reach === 0.8);
  await preview(page); // the local check-in, not an extra paid model call
  expect(asked).toHaveLength(2);
  expect(await page.evaluate(() => (window as Win).__agent.state.plan.summary)).toContain('¿Cómo te resulta?');
  await frames(page, 5);
  await page.screenshot({ path: 'artifacts/companion-conversation.png' });

  await say(page, 'Mejor'); // one-word follow-up keeps the context
  await preview(page);
  expect(asked[2].conversation[1].outcome).toBe('applied');
  expect(asked[2].workspace.comfort.reach).toBe(0.8);
  await pressXR(page, 'agent:plan-forget', 'right', 0);
  await page.waitForFunction(() => !(window as Win).__agent.hasConversation);
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort.reach)).toBe(0.8);
  await say(page, 'Necesito ayuda de nuevo');
  await preview(page);
  expect(asked[3].conversation).toEqual([]);
  expect(errors).toEqual([]);
});

test('discarded proposals stay unexecuted in a follow-up and forgetting by voice leaves settings intact', async ({ page }) => {
  await session(page);
  const asked: any[] = [];
  await page.route('**/api/agent/plan', (route) => {
    asked.push(route.request().postDataJSON());
    return asked.length === 1 ? answer(route, 'I can move the boards to the right.', [{ op: { op: 'set_comfort', side: 'right' }, why: 'Your choice' }]) : answer(route, 'What would you prefer instead?');
  });
  const errors = await enterXR(page);
  await say(page, 'Could you adapt my workspace');
  await preview(page);
  await pressXR(page, 'agent:plan-discard', 'right', 0);
  await say(page, 'I would prefer another option');
  await preview(page);
  expect(asked[1].conversation[0].outcome).toBe('discarded');
  expect(asked[1].workspace.comfort.side).toBe('both');
  await say(page, 'olvida la conversación');
  expect(await page.evaluate(() => (window as Win).__agent.hasConversation)).toBe(false);
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort.side)).toBe('both');
  expect(errors).toEqual([]);
});

test('cancelling and forgetting suppress late answers without contaminating a new conversation', async ({ page }) => {
  await session(page);
  const waiting: Route[] = [];
  const asked: any[] = [];
  await page.route('**/api/agent/plan', (route) => {
    asked.push(route.request().postDataJSON());
    waiting.push(route);
  });
  const errors = await enterXR(page);
  await say(page, 'I need help with the workspace');
  await expect.poll(() => waiting.length).toBe(1);
  await say(page, 'forget conversation');
  await say(page, 'Can you help me read this');
  await expect.poll(() => waiting.length).toBe(2);
  await answer(waiting[0], 'Old response', [{ op: { op: 'set_comfort', reach: 0.5 }, why: 'Old' }]);
  await frames(page, 5);
  expect(await page.evaluate(() => (window as Win).__agent.state.phase)).toBe('thinking');
  await answer(waiting[1], 'New question');
  await preview(page);
  expect(await page.evaluate(() => (window as Win).__agent.state.plan.summary)).toBe('New question');
  expect(asked[1].conversation).toEqual([]);
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort.reach)).toBe(1);
  expect(errors).toEqual([]);
});

test('forgetting during microphone capture suppresses late transcripts', async ({ page }) => {
  await session(page);
  let asked = 0;
  await page.route('**/api/agent/plan', (route) => { asked++; return answer(route, 'What would you like to change?'); });
  await page.route('**/api/voice/session', (route) => route.fulfill({ json: { ok: true, url: 'wss://transcribestreaming.us-east-1.amazonaws.com:8443/stream-transcription-websocket?test=1', language: 'en-US', sampleRate: 16000 } }));
  let sendLate: (() => void) | undefined;
  await page.routeWebSocket(/transcribestreaming/, (ws) => {
    sendLate = () => ws.send(Buffer.from(encodeMessage({ ':event-type': 'TranscriptEvent', ':message-type': 'event', ':content-type': 'application/json' }, new TextEncoder().encode(JSON.stringify({ Transcript: { Results: [{ ResultId: 'late', IsPartial: false, Alternatives: [{ Transcript: 'Private words after forgetting' }] }] } })))));
  });
  const errors = await enterXR(page);
  await say(page, 'Can you help me with the panels');
  await preview(page);
  await pressXR(page, 'agent:plan-reply', 'right', 0);
  await expect.poll(() => !!sendLate).toBe(true);
  await pressXR(page, 'agent:plan-forget', 'right', 0);
  sendLate!();
  await page.waitForFunction(() => !(window as Win).__agent.hasConversation);
  await page.waitForTimeout(1800); // Transcribe's bounded drain after stopping the microphone
  expect(asked).toBe(1);
  expect(await page.evaluate(() => (window as Win).__heard)).toBeNull();
  expect(await page.evaluate(() => (window as Win).__notice.text)).not.toContain('Private words');
  expect(errors).toEqual([]);
});
