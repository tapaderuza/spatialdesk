/**
 * Direct voice (src/voice/commands.ts, src/panel.ts): "bigger text" and "move <card> to <column>" act at once, with Undo,
 * without asking the AI; a longer sentence, "this" (the gaze), or words that name no single card still go to the agent.
 * And the priority mark tells priority by its width as well as its colour (src/workspace/boards.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import { parseCommand } from '../src/voice/commands.js';
import { openWorkspace, type Win } from './helpers.js';

const say = (page: Page, words: string) => page.evaluate((w) => (window as Win).__voice.say(w), words);
const notice = (page: Page) => page.evaluate(() => ((window as Win).__notice?.text ?? '') as string);

test('the words: short size requests and named moves are direct; the long sentence and "this" stay the agent\'s', () => {
  expect(parseCommand('Bigger text, please.')).toEqual({ kind: 'text-size', bigger: true });
  expect(parseCommand('make the text smaller')).toEqual({ kind: 'text-size', bigger: false });
  expect(parseCommand('Letra más grande')).toEqual({ kind: 'text-size', bigger: true });
  expect(parseCommand('texto más pequeño')).toEqual({ kind: 'text-size', bigger: false });
  expect(parseCommand('Bring everything closer and make the text bigger')?.kind).toBe('comfort');
  expect(parseCommand('Move the dentist call to Done.')).toEqual({ kind: 'move-card', card: 'dentist call', column: 'done', said: 'Move the dentist call to Done.' });
  expect(parseCommand('mueve la llamada a hecho')).toMatchObject({ kind: 'move-card', card: 'llamada', column: 'hecho' });
  expect(parseCommand('move it to in progress')?.kind).toBe('ask');
  expect(parseCommand('move this to done')?.kind).toBe('ask');
  expect(parseCommand('mueve esto a hecho')?.kind).not.toBe('move-card');
  expect(parseCommand('move the report to the top')?.kind).toBe('ask');
});

test('"bigger text" by voice: every panel a step larger at once, Undo puts it back, and it stops at the largest', async ({ page }) => {
  const errors = await openWorkspace(page);
  const scale = () => page.evaluate(() => (window as Win).__workspace.state.comfort.scale as number);
  expect(await scale()).toBe(1);
  await say(page, 'bigger text');
  expect(await scale()).toBeCloseTo(1.2, 5);
  expect(await notice(page)).toContain('Text larger');
  await say(page, 'undo');
  expect(await scale()).toBe(1);
  for (let i = 0; i < 6; i++) await say(page, 'letra más grande');
  expect(await scale()).toBeCloseTo(1.8, 5);
  expect(await notice(page)).toContain('as large as it goes');
  await say(page, 'smaller text');
  expect(await scale()).toBeCloseTo(1.6, 5);
  expect(errors).toEqual([]);
});

test('"move <card> to <column>" by voice: the one card named moves at once, with Undo; words in several cards are not guessed', async ({ page }) => {
  const errors = await openWorkspace(page);
  const where = (title: string) =>
    page.evaluate((t) => {
      for (const board of (window as Win).__workspace.state.boards) for (const column of board.columns) if (column.cards.some((card: any) => card.title === t)) return column.title as string;
      return null;
    }, title);
  const boards = () => page.evaluate(() => JSON.stringify((window as Win).__workspace.state.boards.map((b: any) => b.columns.map((c: any) => c.cards.map((k: any) => k.id)))));

  expect(await where('Try Focus mode for deep work')).toBe('To do');
  await say(page, 'Move focus mode to Done.');
  expect(await where('Try Focus mode for deep work')).toBe('Done');
  expect(await notice(page)).toContain('Moved "Try Focus mode for deep work" to Done');
  await say(page, 'undo');
  expect(await where('Try Focus mode for deep work')).toBe('To do');

  // "Tap" is in two cards: nothing is guessed, the board stays as it was, and the sentence goes to the agent.
  const before = await boards();
  await say(page, 'move tap to done');
  expect(await page.evaluate(() => (window as Win).__heard.command.kind)).toBe('move-card');
  expect(await boards()).toBe(before);
  expect(await notice(page)).toContain('Asking the AI');
  expect(errors).toEqual([]);
});

test('priority is in the mark\'s width, not in its colour alone', async ({ page }) => {
  const errors = await openWorkspace(page);
  const widths = () =>
    page.evaluate(() => {
      const found: number[] = [];
      (window as Win).__world.scene.traverse((o: any) => {
        if (/:card-\d+-\d+-mark$/.test(o.name ?? '') && typeof o.properties?.value?.width === 'number') found.push(o.properties.value.width);
      });
      return found;
    });
  await expect.poll(async () => (await widths()).includes(1.2), { timeout: 10_000 }).toBe(true); // "Plan my day with the AI agent": high
  expect(await widths()).toContain(0.6); // the rest: normal
  expect(errors).toEqual([]);
});
