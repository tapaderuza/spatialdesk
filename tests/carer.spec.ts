/**
 * The 2D companion for a family member or carer (companion.html, /?mode=companion) and the headset it follows. Two pages
 * of one browser talk through a stand-in for the helper service: the owner says "invite a helper", the carer types the
 * code, nothing is shown until the owner presses Allow, then the Today board follows the headset, and Help / Recalibrate
 * opens the guided setup in the headset and learns how it went. The companion page must not load the XR world.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { FakeAssist } from './assist-fake.js';
import { enterXR, pressXR, settled, type Win } from './helpers.js';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1')); // no first-run coach in the way
});

/** The companion page, with its page errors. */
async function companion(context: BrowserContext, path = '/companion.html'): Promise<{ page: Page; errors: string[] }> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path);
  return { page, errors };
}

/** A pointer press on the headset page. With a second page open, the headset page is brought to the front first. */
async function press(page: Page, name: string): Promise<void> {
  await page.bringToFront();
  await pressXR(page, name);
}

const helperStage = (page: Page, stage: string, timeout = 12_000) =>
  page.waitForFunction((stage) => (window as Win).__helper?.view.stage === stage, stage, { timeout });

test('the whole story: invite by voice, the code, Allow, the board follows, Help opens the setup, Stop ends it', async ({ context, page }) => {
  test.setTimeout(150_000);
  const fake = new FakeAssist();
  await fake.install(context);
  const errors = await enterXR(page, '&fast');

  // The owner asks for a helper: the panel shows a code and where to type it.
  await page.evaluate(() => (window as Win).__voice.say('invite a helper'));
  await helperStage(page, 'inviting');
  const code = await page.evaluate(() => (window as Win).__helper.state.code as string);
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4} [A-HJ-NP-Z2-9]{4}$/);
  const panel = await page.evaluate(() => (window as Win).__helper.view);
  expect(panel.title).toContain(code);
  expect(panel.hint).toContain('/companion.html');
  expect(panel).toMatchObject({ open: true, a: 'New code', b: 'Stop' });

  // The carer types it on their own screen. Nothing is shown until the owner allows it.
  const { page: carer, errors: carerErrors } = await companion(context);
  await carer.locator('#code').fill(code);
  await carer.locator('#connect').click();
  await expect(carer.locator('h2')).toHaveText('Waiting for them to allow it');
  await expect(carer.locator('#board')).toHaveCount(0);
  await helperStage(page, 'asking');
  expect(await page.evaluate(() => (window as Win).__helper.view)).toMatchObject({ title: 'Show your Today board?', a: 'Allow', b: 'No' });
  expect(fake.approvals, 'a request alone shares nothing').toEqual([]);

  // Allow, with the pointer: the Today board's card titles, and nothing else, reach the carer.
  await press(page, 'helper:a');
  await helperStage(page, 'sharing');
  await expect(carer.locator('#board')).toContainText('Tap a card to pick it up', { timeout: 12_000 });
  await expect(carer.locator('#board')).toContainText('Doing');
  expect(fake.approvals).toHaveLength(1);
  expect(Object.keys(fake.approvals[0]).sort()).toEqual(['allowConfiguration', 'requestId', 'tasks']);
  expect(fake.approvals[0].allowConfiguration).toBe(false);
  for (const task of fake.approvals[0].tasks) expect(Object.keys(task).sort()).toEqual(['column', 'id', 'title']);

  // A card added in the headset appears on the carer's screen.
  await page.evaluate(() => {
    const ws = (window as Win).__workspace;
    ws.dispatch({ op: 'add_card', board: ws.state.focusBoardId ?? ws.state.boards[0].id, title: 'Call mum' });
  });
  await expect(carer.locator('#board')).toContainText('Call mum', { timeout: 12_000 });

  // Help / Recalibrate: the guided setup opens in the headset, with its orb; the carer is told, then that it was finished.
  await carer.bringToFront();
  await carer.locator('#help').click();
  await expect(carer.locator('#help-status')).toContainText('Sent', { timeout: 5_000 });
  await page.waitForFunction(() => (window as Win).__setup.view.stage === 'where', null, { timeout: 12_000 });
  await expect(carer.locator('#help-status')).toContainText('showing the setup', { timeout: 12_000 });
  await expect(carer.locator('#help')).toBeDisabled();
  expect(await page.evaluate(() => (window as Win).__helper.state.helpCalls)).toBe(1);
  await page.evaluate(() => (window as Win).__setup.choose('a')); // Desk
  await page.waitForFunction(() => (window as Win).__setup.view.stage === 'reach');
  expect(await page.evaluate(() => (window as Win).__world.scene.getObjectByName('setup-orb').visible), 'the orb is there').toBe(true);
  await page.evaluate(() => (window as Win).__setup.choose('a')); // skip the reach
  await page.waitForFunction(() => (window as Win).__setup.view.stage === 'steady');
  await page.evaluate(() => (window as Win).__setup.choose('b')); // No
  await page.evaluate(() => (window as Win).__setup.choose('a')); // Start
  await expect(carer.locator('#help-status')).toContainText('finished the setup', { timeout: 12_000 });
  await expect(carer.locator('#help')).toBeEnabled();

  // The helper panel comes back once the setup is closed; Stop sharing ends it for the carer too.
  await helperStage(page, 'sharing');
  await page.waitForFunction(() => (window as Win).__helper.view.open && (window as Win).__helper.view.a === 'Stop sharing');
  await press(page, 'helper:a');
  await helperStage(page, 'ended');
  await expect(carer.locator('h2')).toHaveText('This session has ended', { timeout: 12_000 });
  expect(fake.rooms.size).toBe(0);
  expect(errors).toEqual([]);
  expect(carerErrors).toEqual([]);
});

test('brought close, the helper and the setup still stand in front of the work board: Allow and Sofa/Bed take the ray', async ({ context, page }) => {
  test.setTimeout(120_000);
  const fake = new FakeAssist();
  await fake.install(context);
  const errors = await enterXR(page, '&fast');
  // "Bring it closer": the work board comes to 0.62 m x 0.8, nearer than the 0.55 m these panels were designed at.
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'set_comfort', reach: 0.8 }));
  await settled(page);
  /** How much nearer the eyes a panel's control is than the work board, along the view (metres). */
  const ahead = (name: string) =>
    page.evaluate((name) => {
      const w = (window as Win).__world;
      const find = (n: string) => {
        let el: any = null;
        w.scene.traverse((o: any) => {
          if (o.name === n) el = o;
        });
        el.updateWorldMatrix(true, false);
        return el;
      };
      const V = w.camera.position.constructor;
      const eye = w.camera.getWorldPosition(new V());
      const forward = w.camera.getWorldDirection(new V());
      const depth = (n: string) => new V().setFromMatrixPosition(find(n).matrixWorld).sub(eye).dot(forward) as number;
      return depth('b1:card-0-0') - depth(name);
    }, name);

  await page.evaluate(() => (window as Win).__voice.say('invite a helper'));
  await helperStage(page, 'inviting');
  const code = await page.evaluate(() => (window as Win).__helper.state.code as string);
  const { page: carer } = await companion(context);
  await carer.locator('#code').fill(code);
  await carer.locator('#connect').click();
  await helperStage(page, 'asking');
  expect(await ahead('helper:a')).toBeGreaterThan(0.05);
  await press(page, 'helper:a'); // Allow: the ray reaches it before the board behind
  await helperStage(page, 'sharing');

  // Help / Recalibrate opens the setup, in front of the board as well.
  await carer.locator('#help').click();
  await page.waitForFunction(() => (window as Win).__setup.view.stage === 'where', null, { timeout: 12_000 });
  expect(await ahead('setup:setup-b')).toBeGreaterThan(0.05);
  await press(page, 'setup:setup-b'); // Sofa/Bed
  await page.waitForFunction(() => (window as Win).__setup.view.stage === 'reach', null, { timeout: 8_000 });
  expect(errors).toEqual([]);
});

test('"No" refuses: the carer never sees a card and the code stops working', async ({ context, page }) => {
  test.setTimeout(90_000);
  const fake = new FakeAssist();
  await fake.install(context);
  const errors = await enterXR(page, '&fast');
  await page.evaluate(() => (window as Win).__voice.say('invite my carer'));
  await helperStage(page, 'inviting');
  const code = await page.evaluate(() => (window as Win).__helper.state.code as string);
  const { page: carer } = await companion(context);
  await carer.locator('#code').fill(code.toLowerCase()); // typed in lower case, with the space
  await carer.locator('#connect').click();
  await helperStage(page, 'asking');
  await press(page, 'helper:b'); // No
  await helperStage(page, 'ended');
  await expect(carer.locator('h2')).toHaveText('This session has ended', { timeout: 12_000 });
  await expect(carer.locator('#board')).toHaveCount(0);
  expect(fake.approvals).toEqual([]);
  expect(fake.rooms.size).toBe(0);
  expect(errors).toEqual([]);
});

test('the carer alone: wrong codes are explained, the board is text, a lost network says so, a reload carries on', async ({ context }) => {
  test.setTimeout(120_000);
  const fake = new FakeAssist();
  await fake.install(context);
  const room = fake.room([
    { id: 'k1', title: '<img src=x onerror="window.__pwned=1">Take the tablet', column: 'To do' },
    { id: 'k2', title: 'Water the plant', column: 'Done' },
  ]);
  const { page, errors } = await companion(context);

  await page.locator('#code').fill('ABC');
  await page.locator('#connect').click();
  await expect(page.locator('#code-error')).toHaveText('Type the 8 characters of the code.');
  await page.locator('#code').fill('ZZZZ9999');
  await page.locator('#connect').click();
  await expect(page.locator('#code-error')).toContainText('not valid or has expired');

  await page.locator('#code').fill(room.code);
  await page.locator('#connect').click();
  await expect(page.locator('h2')).toHaveText('Waiting for them to allow it');
  room.allow();
  await expect(page.locator('#board')).toContainText('Take the tablet', { timeout: 12_000 });
  await expect(page.locator('#board img'), 'a card title is text, never markup').toHaveCount(0);
  expect(await page.evaluate(() => (window as Win).__pwned)).toBeUndefined();
  await expect(page.locator('#board li[data-done="true"]')).toHaveText('Water the plant'); // the last column reads as done
  await expect(page.locator('#updated')).toContainText('Updated');

  // The network drops: the board stays, the pill says so; it comes back by itself.
  await page.route('**/api/assist/**', (route) => route.abort('connectionfailed'));
  await expect(page.locator('#status-text')).toHaveText('Reconnecting...', { timeout: 15_000 });
  await expect(page.locator('#board')).toContainText('Take the tablet');
  await page.unroute('**/api/assist/**');
  await expect(page.locator('#status-text')).toHaveText('Connected', { timeout: 20_000 });

  // Changed cards arrive; a reload of the tab picks the session up again.
  room.show([{ id: 'k3', title: 'Phone the pharmacy', column: 'To do' }]);
  await expect(page.locator('#board')).toContainText('Phone the pharmacy', { timeout: 12_000 });
  await page.reload();
  await expect(page.locator('#board')).toContainText('Phone the pharmacy', { timeout: 12_000 });

  // The owner's side ends it.
  room.end();
  await expect(page.locator('h2')).toHaveText('This session has ended', { timeout: 12_000 });
  await page.locator('#again').click();
  await expect(page.locator('#code')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Help / Recalibrate states: waiting, still waiting, cooldown and the carer told it was skipped', async ({ context }) => {
  test.setTimeout(90_000);
  const fake = new FakeAssist();
  await fake.install(context);
  const room = fake.room([{ id: 'k1', title: 'Take the tablet', column: 'To do' }]);
  const { page } = await companion(context);
  await page.locator('#code').fill(room.code);
  await page.locator('#connect').click();
  await expect(page.locator('h2')).toHaveText('Waiting for them to allow it'); // joined, so there is someone to allow
  room.allow();
  await expect(page.locator('#help')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('#help-status')).toHaveText('They can skip any step of it.');
  await page.locator('#help').click();
  await expect(page.locator('#help-status')).toContainText('Sent. Waiting');
  await expect(page.locator('#help')).toBeDisabled(); // one call at a time
  room.answer('dismissed');
  await expect(page.locator('#help-status')).toContainText('They skipped it', { timeout: 12_000 });
  await expect(page.locator('#help')).toBeEnabled();
  await page.locator('#help').click(); // inside the server's cooldown
  await expect(page.locator('#help-status')).toContainText('Wait a few seconds', { timeout: 5_000 });
});

test('the companion page is light and apart from the XR app; /?mode=companion goes there, in Spanish with ?lang', async ({ context, page }) => {
  const fake = new FakeAssist();
  await fake.install(context);
  let bytes = 0;
  const loaded: string[] = [];
  page.on('response', async (response) => {
    if (!/\.(js|css|html)(\?|$)/.test(response.url())) return;
    loaded.push(new URL(response.url()).pathname);
    bytes += (await response.body().catch(() => Buffer.alloc(0))).length;
  });
  await page.goto('/?mode=companion&lang=es-ES');
  await expect(page).toHaveURL(/\/companion\.html\?mode=companion&lang=es-ES$/);
  await expect(page.locator('label')).toHaveText('Codigo de sus gafas');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  expect(await page.evaluate(() => (window as Win).__world), 'no XR world on this page').toBeUndefined();
  expect(loaded.filter((url) => /emulator|iwer|three/i.test(url))).toEqual([]);
  expect(bytes, 'the whole page, in bytes').toBeLessThan(150_000);

  // The XR app does not carry the companion's styles.
  const app = await context.newPage();
  await app.goto('/');
  expect(await app.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--help'))).toBe('');
  expect(await app.evaluate(() => document.querySelector('link[href*="companion"]'))).toBeNull();
});
