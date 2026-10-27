import { expect, test, type Page } from '@playwright/test';
import { forgetResumeNote, nextStepText, readResumeNote, resumeContext, returnTasks, saveResumeNote } from '../src/agent/resume-note.js';
import { parseCommand } from '../src/voice/commands.js';
import { encodeMessage } from '../src/voice/eventstream.js';
import type { Workspace } from '../src/workspace/model.js';
import { enterXR, frames, pressXR, restHands, type Win } from './helpers.js';

test.use({ launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });

const key = 'spatialdesk.resume-note';
const press = async (page: Page, name: string) => { await restHands(page); await pressXR(page, name, 'right', 0.2); await frames(page, 6); };
const voice = (page: Page, text: string) => page.evaluate(t => (window as Win).__voice.say(t), text);
const note = { version: 1 as const, savedAt: 1, boardId: 'b1', cardId: 'k1', nextStep: 'Check the amount', timerId: 't1' };

test('return storage: only the explicit checkpoint, bounded text and honest storage errors', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  expect(saveResumeNote({ ...note, energy: 'low', conversation: ['private'] } as any, storage)).toBe(true);
  expect(Object.keys(JSON.parse(values.get(key)!)).sort()).toEqual(['boardId', 'cardId', 'nextStep', 'savedAt', 'timerId', 'version']);
  expect(readResumeNote(storage)?.nextStep).toBe('Check the amount');
  expect(saveResumeNote({ ...note, nextStep: 'x'.repeat(181) }, storage)).toBe(false);
  expect(nextStepText('  Check\n the amount  ')).toBe('Check the amount');
  values.set(key, '{broken');
  expect(readResumeNote(storage)).toBeNull();
  values.set(key, JSON.stringify({ ...note, cardId: '' }));
  expect(readResumeNote(storage)).toBeNull();
  expect(forgetResumeNote(storage)).toBe(true);
  const blocked = { ...storage, setItem: () => { throw Error('full'); }, removeItem: () => { throw Error('denied'); } };
  expect(saveResumeNote(note, blocked)).toBe(false);
  expect(forgetResumeNote(blocked)).toBe(false);
});

test('return resolution uses stable IDs and current titles, never completed or deleted cards', () => {
  const ws = { boards: [{ id: 'b1', title: 'Today', columns: [
    { id: 'todo', cards: [{ id: 'k1', title: 'Same title' }] }, { id: 'doing', cards: [] }, { id: 'done', cards: [{ id: 'k2', title: 'Same title' }] },
  ] }], timers: [{ id: 't1', state: 'paused', cardId: 'k1' }], focusBoardId: 'b1' } as unknown as Workspace;
  expect(resumeContext(note, ws)).toMatchObject({ status: 'ready', task: { card: { id: 'k1' } }, timer: { id: 't1' } });
  expect(resumeContext({ ...note, cardId: 'k2' }, ws)).toEqual({ status: 'done' });
  expect(resumeContext({ ...note, cardId: 'missing' }, ws)).toEqual({ status: 'missing' });
  expect(resumeContext(note, { ...ws, timers: [{ ...ws.timers[0], cardId: 'k2' }] })).not.toHaveProperty('timer.id');
  expect(returnTasks(ws).map(t => t.card.id)).toEqual(['k1']);
  expect(returnTasks({ ...ws, boards: [{ ...ws.boards[0], columns: [ws.boards[0].columns[2]] }] })).toEqual([]);
});

test('return voice: explicit save, reopen, forget and a user-authored next step', () => {
  expect(parseCommand('Necesito parar')).toEqual({ kind: 'open-return' });
  expect(parseCommand('Guarda y pausa')).toEqual({ kind: 'save-return' });
  expect(parseCommand('¿Por dónde iba?')).toEqual({ kind: 'resume-return' });
  expect(parseCommand('¿Dónde estaba?')).toEqual({ kind: 'resume-return' });
  expect(parseCommand('Olvida mi punto de retorno')).toEqual({ kind: 'forget-return' });
  expect(parseCommand('Cuando vuelva, comprobar el importe')).toEqual({ kind: 'return-note', text: 'comprobar el importe' });
  expect(parseCommand('When I return, open the letter')).toEqual({ kind: 'return-note', text: 'open the letter' });
});

async function setup(page: Page) {
  await page.route('**/api/sessions', r => r.fulfill({ json: { sessionId: 'test-return-session-00000000', protocol: 1 } }));
  let models = 0;
  await page.route('**/api/agent/plan', r => { models++; return r.abort(); });
  const errors = await enterXR(page, '&lang=es-ES');
  await pressXR(page, 'coach:coach-skip');
  const ids = await page.evaluate(() => {
    const ws = (window as Win).__workspace;
    const board = ws.state.boards[0], card = board.columns[0].cards[0];
    ws.dispatch({ op: 'start_timer', card: card.id, minutes: 25, label: 'Session: current task' });
    return { card: card.id, board: board.id, timer: ws.state.timers.at(-1).id };
  });
  return { ids, errors, models: () => models };
}

test('return: review, explicit save, freeze, reload, preview, Apply, Undo and forget without AI', async ({ page }) => {
  const { ids, errors, models } = await setup(page);
  await press(page, 'command:session-button');
  await press(page, 'agent:session-return');
  expect(await page.evaluate(() => (window as Win).__agent.phase)).toBe('resume');
  await voice(page, 'Cuando vuelva, comprobar el importe de la factura');
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBeNull();
  await page.screenshot({ path: 'artifacts/return-draft.png' });
  await press(page, 'agent:plan-reply');
  const frozen = await page.evaluate(() => (window as Win).__workspace.state.timers.at(-1));
  expect(frozen).toMatchObject({ id: ids.timer, state: 'paused' });
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.at(-1).remainingMs)).toBe(frozen.remainingMs);
  await enterXR(page, '&lang=es-ES');
  await voice(page, '¿Por dónde iba?');
  await frames(page, 10);
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key)).toMatchObject({ cardId: ids.card, nextStep: 'comprobar el importe de la factura' });
  await page.screenshot({ path: 'artifacts/return-saved.png' });
  await press(page, 'agent:plan-apply');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan.source)).toBe('saved-work');
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.at(-1).state)).toBe('paused');
  await press(page, 'agent:plan-apply');
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.map((t: any) => ({ id: t.id, state: t.state })))).toEqual([{ id: ids.timer, state: 'running' }]);
  await voice(page, 'deshacer');
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.at(-1).state)).toBe('paused');
  await voice(page, '¿Por dónde iba?');
  await frames(page, 8);
  await press(page, 'agent:return-forget');
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBeNull();
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.at(-1).state)).toBe('paused');
  expect(models()).toBe(0);
  expect(errors).toEqual([]);
});

test('return: a completed task or a different running block cannot be resumed from an old preview', async ({ page }) => {
  const { ids, errors } = await setup(page);
  await voice(page, 'Guarda y pausa');
  await press(page, 'agent:plan-apply');
  await page.evaluate(card => (window as Win).__workspace.dispatch({ op: 'move_card', card, column: 'Done' }), ids.card);
  await press(page, 'agent:plan-apply');
  expect(await page.evaluate(() => (window as Win).__agent.phase)).toBe('error');
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.at(-1).state)).toBe('paused');
  await voice(page, '¿Por dónde iba?');
  expect(await page.evaluate(() => (window as Win).__agent.phase)).toBe('resume');
  expect(errors).toEqual([]);
});

test('return: a new timer while the preview is open is preserved', async ({ page }) => {
  const { ids } = await setup(page);
  await voice(page, 'Guarda y pausa');
  await press(page, 'agent:plan-apply');
  await voice(page, 'Focus');
  await press(page, 'agent:plan-apply');
  expect(await page.evaluate(() => (window as Win).__agent.phase)).toBe('error');
  expect(await page.evaluate(id => (window as Win).__workspace.state.timers.find((t: any) => t.id === id).state, ids.timer)).toBe('paused');
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.filter((t: any) => t.state === 'running').length)).toBe(1);
});

test('return: storage failure cannot pause the active clock', async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) { if (k === 'spatialdesk.resume-note') throw Error('quota'); return set.call(this, k, v); };
  });
  const { ids } = await setup(page);
  await voice(page, 'Guarda y pausa');
  expect(await page.evaluate(id => (window as Win).__workspace.state.timers.find((t: any) => t.id === id).state, ids.timer)).toBe('running');
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBeNull();
});

test.describe('return microphone', () => {
  test('the Dictate button captures a plain next step without asking the AI or saving it', async ({ page }) => {
    await page.routeWebSocket('**/ws?*', ws => { ws.onMessage(() => {}); });
    await page.route('**/api/voice/session', r => r.fulfill({ json: { ok: true, url: 'wss://return-test.invalid/voice' } }));
    await page.routeWebSocket('wss://return-test.invalid/voice', ws => {
      const frame = encodeMessage({ ':message-type': 'event', ':event-type': 'TranscriptEvent' }, new TextEncoder().encode(JSON.stringify({ Transcript: { Results: [{ ResultId: 'note-1', IsPartial: false, Alternatives: [{ Transcript: 'comprobar el importe' }] }] } })));
      ws.send(Buffer.from(frame));
      ws.onMessage(() => {});
    });
    const { errors, models } = await setup(page);
    await voice(page, 'Necesito parar');
    await frames(page, 8);
    await press(page, 'agent:return-note');
    await expect.poll(() => page.evaluate(() => (window as Win).__agent.returnState)).toMatchObject({ nextStep: 'comprobar el importe', dictating: false });
    expect(await page.evaluate(k => localStorage.getItem(k), key)).toBeNull();
    expect(models()).toBe(0);
    expect(errors).toEqual([]);
  });
});
