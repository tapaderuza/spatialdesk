import { expect, test } from '@playwright/test';
import { parseCommand } from '../src/voice/commands.js';
import { enterXR, frames, pressXR, restHands, type Win } from './helpers.js';

test('session voice: explicit time and self-reported energy, preserving comfort requests', () => {
  expect(parseCommand('Hoy tengo diez minutos y estoy cansada')).toMatchObject({ kind: 'session', choice: { minutes: 10, energy: 'low' } });
  expect(parseCommand('I only have 15 minutes')).toMatchObject({ kind: 'session', choice: { minutes: 15, energy: 'steady' } });
  expect(parseCommand('Siguiente sesión')).toMatchObject({ kind: 'session', choice: undefined });
  expect(parseCommand('Me duelen los ojos y tengo 10 minutos')).toMatchObject({ kind: 'comfort' });
  expect(parseCommand('Tengo 2 minutos')).toMatchObject({ kind: 'session', choice: { minutes: 2 } });
});

test('session: choose, review, apply, finish, and choose again without automatic continuation', async ({ page }) => {
  await page.route('**/api/sessions', r => r.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  const asked: any[] = [];
  await page.route('**/api/agent/plan', async r => {
    const body = r.request().postDataJSON();
    asked.push(body);
    const task = body.workspace.boards[0].columns[0].cards[0].title;
    return r.fulfill({ json: { ok: true, source: 'test-model', summary: 'Puedo proponerte cinco minutos para empezar esta tarea.', steps: [
      { op: { op: 'move_card', card: task, column: 'Doing' }, why: 'One task' },
      { op: { op: 'start_timer', card: task, minutes: 5, label: `Session: ${task}` }, why: 'Within your choice' },
    ] } });
  });
  const errors = await enterXR(page, '&fast&lang=es-ES');
  await pressXR(page, 'coach:coach-skip');
  const doneBefore = await page.evaluate(() => (window as Win).__workspace.state.boards[0].columns[2].cards.map((c: any) => c.id));
  await restHands(page);
  await pressXR(page, 'command:session-button', 'left', 0.2);
  await page.waitForFunction(() => (window as Win).__agent.phase === 'session');
  await frames(page, 10);
  await pressXR(page, 'agent:session-5', 'right', 0.2);
  await pressXR(page, 'agent:energy-low', 'right', 0.2);
  await page.screenshot({ path: 'artifacts/session-choice.png' });
  await pressXR(page, 'agent:plan-reply', 'right', 0.2);
  await page.waitForFunction(() => (window as Win).__agent.phase === 'preview');
  expect(asked[0]).toMatchObject({ intent: 'session', sessionChoice: { minutes: 5, energy: 'low' } });
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers)).toHaveLength(0);
  await pressXR(page, 'agent:plan-apply', 'right', 0.2);
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.some((t: any) => t.state === 'done'), null, { timeout: 15_000 });
  await page.waitForFunction(() => (window as Win).__agent.state.plan?.source === 'session-clock');
  expect(asked).toHaveLength(1);
  expect(await page.evaluate(() => (window as Win).__workspace.state.boards[0].columns[2].cards.map((c: any) => c.id))).toEqual(doneBefore);
  await page.screenshot({ path: 'artifacts/session-complete.png' });
  await page.evaluate(() => (window as Win).__voice.say('sí'));
  expect(await page.evaluate(() => (window as Win).__agent.phase)).toBe('session');
  expect(asked).toHaveLength(1); // opens choices, not another timer or model call
  expect(errors).toEqual([]);
});

test('session: a card finished while the proposal is open cannot be started again', async ({ page }) => {
  await page.route('**/api/sessions', r => r.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/agent/plan', r => {
    const body = r.request().postDataJSON();
    const task = body.workspace.boards[0].columns[0].cards[0].title;
    return r.fulfill({ json: { ok: true, source: 'test-model', summary: 'One block', steps: [{ op: { op: 'start_timer', minutes: 5, card: task, label: `Session: ${task}` }, why: 'Five minutes' }] } });
  });
  const errors = await enterXR(page, '&fast&lang=es-ES');
  await pressXR(page, 'coach:coach-skip');
  await page.evaluate(() => (window as Win).__voice.say('Tengo 10 minutos y poca energía'));
  await page.waitForFunction(() => (window as Win).__agent.phase === 'preview');
  await page.evaluate(() => { const ws = (window as Win).__workspace; ws.dispatch({ op: 'move_card', card: ws.state.boards[0].columns[0].cards[0].id, column: 'Done' }); });
  await pressXR(page, 'agent:plan-apply', 'right', 0.2);
  expect(await page.evaluate(() => (window as Win).__agent.phase)).toBe('error');
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers)).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('session: a timer started after the proposal is preserved without starting another', async ({ page }) => {
  await page.route('**/api/sessions', r => r.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/agent/plan', r => {
    const task = r.request().postDataJSON().workspace.boards[0].columns[0].cards[0].title;
    return r.fulfill({ json: { ok: true, source: 'test-model', summary: 'One block', steps: [{ op: { op: 'start_timer', minutes: 5, card: task, label: `Session: ${task}` }, why: 'Five minutes' }] } });
  });
  const errors = await enterXR(page);
  await pressXR(page, 'coach:coach-skip');
  await page.evaluate(() => (window as Win).__voice.say('Tengo 10 minutos'));
  await page.waitForFunction(() => (window as Win).__agent.phase === 'preview');
  await page.evaluate(() => (window as Win).__voice.say('Focus'));
  const timer = await page.evaluate(() => (window as Win).__workspace.state.timers[0].id);
  await pressXR(page, 'agent:plan-apply', 'right', 0.2);
  expect(await page.evaluate(() => (window as Win).__agent.phase)).toBe('error');
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.map((t: any) => t.id))).toEqual([timer]);
  expect(errors).toEqual([]);
});
