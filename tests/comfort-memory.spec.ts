import { expect, test } from '@playwright/test';
import { forgetComfortMemory, readComfortMemory, saveComfortMemory } from '../src/agent/comfort-memory.js';
import { enterXR, frames, pressXR, restHands, lookAt, type Win } from './helpers.js';

const comfortable = { reach: 0.8, scale: 1.4, side: 'right' as const, turnDeg: 25, tiltDeg: -10 };

test('saved setup stores only explicit settings and rejects corrupt or out-of-range data', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  expect(saveComfortMemory({ ...comfortable, transcript: 'Never store this' } as any, storage)).toBe(true);
  expect(values.values().next().value).not.toContain('Never store this');
  expect(readComfortMemory(storage)?.comfort).toEqual(comfortable);
  expect(saveComfortMemory({ ...comfortable, reach: Infinity }, storage)).toBe(false);
  expect(readComfortMemory(storage)?.comfort).toEqual(comfortable);
  values.set('spatialdesk.comfort-memory', '{broken');
  expect(readComfortMemory(storage)).toBeNull();
  values.set('spatialdesk.comfort-memory', JSON.stringify({ version: 1, savedAt: 1, comfort: { ...comfortable, scale: 99 } }));
  expect(readComfortMemory(storage)).toBeNull();
  expect(forgetComfortMemory(storage)).toBe(true);
  expect(readComfortMemory(storage)).toBeNull();
  const blocked = { ...storage, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
  expect(saveComfortMemory(comfortable, blocked)).toBe(false);
  expect(forgetComfortMemory(blocked)).toBe(false);
});

test('saved setup: consent, another visit, offline preview, Apply, Undo and forgetting', async ({ page }) => {
  let modelCalls = 0;
  await page.route('**/api/sessions', (r) => r.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/agent/plan', (r) => { modelCalls++; return r.abort(); });
  const errors = await enterXR(page, '&lang=es-ES');
  await pressXR(page, 'coach:coach-skip');
  await page.evaluate((c) => (window as Win).__workspace.dispatch({ op: 'set_comfort', ...c }), comfortable);
  expect(await page.evaluate(() => localStorage.getItem('spatialdesk.comfort-memory'))).toBeNull();
  await page.evaluate(() => (window as Win).__voice.say('mi ajuste'));
  await page.waitForFunction(() => (window as Win).__agent.phase === 'memory');
  await frames(page, 10); // the card switches from its plan layout to the setup controls
  await restHands(page); // no inactive emulated hand should poke the nearby card during a controller click
  await lookAt(page, 'agent:plan-reply');
  await pressXR(page, 'agent:plan-reply', 'right', 0.2); // The lowered, near card needs the controller at the seated user's body, behind the poke zone.
  await expect.poll(() => page.evaluate(() => ({ saved: !!localStorage.getItem('spatialdesk.comfort-memory'), phase: (window as Win).__agent.phase, notice: (window as Win).__notice?.text }))).toMatchObject({ saved: true });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.comfort-memory')!).comfort)).toEqual(comfortable);
  await page.screenshot({ path: 'artifacts/comfort-memory.png' });
  const temporary = { reach: 1.2, scale: 1, side: 'both', turnDeg: 120, tiltDeg: 0 };
  await page.evaluate((c) => { (window as Win).__workspace.dispatch({ op: 'set_comfort', ...c }); (window as Win).__workspace.flush(); }, temporary);
  await enterXR(page, '&lang=es-ES'); // another visit, same browser storage
  const before = await page.evaluate(() => ({ comfort: (window as Win).__workspace.state.comfort, titles: (window as Win).__workspace.state.boards.map((b: any) => b.title) }));
  expect(before.comfort).toEqual(temporary);
  await page.evaluate(() => (window as Win).__voice.say('recupera mi ajuste'));
  await page.waitForFunction(() => (window as Win).__agent.phase === 'preview');
  expect(await page.evaluate(() => (window as Win).__agent.state.plan.source)).toBe('saved-setup');
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort)).toEqual(temporary);
  await pressXR(page, 'agent:plan-apply', 'right', 0);
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort)).toEqual(comfortable);
  expect(await page.evaluate(() => (window as Win).__workspace.state.boards.map((b: any) => b.title))).toEqual(before.titles);
  await page.evaluate(() => (window as Win).__voice.say('deshacer'));
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort)).toEqual(temporary);
  await page.evaluate(() => (window as Win).__voice.say('mi ajuste'));
  await frames(page, 5);
  await pressXR(page, 'agent:plan-forget-setup', 'right', 0);
  expect(await page.evaluate(() => localStorage.getItem('spatialdesk.comfort-memory'))).toBeNull();
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort)).toEqual(temporary);
  expect(modelCalls).toBe(0);
  expect(errors).toEqual([]);
});
