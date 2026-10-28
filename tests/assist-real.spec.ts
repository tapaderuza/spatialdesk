/**
 * The carer and the headset against the REAL helper service (server/app), not the stand-in of tests/assist-fake.ts: the
 * same story as tests/carer.spec.ts, so a difference between the stand-in and the server cannot hide. Skipped unless
 * a local server is named, so the normal suite needs none:
 *
 *   PORT=18080 SPATIALDESK_AGENT_MODE=built-in SPATIALDESK_VOICE_ENABLED=false java -jar server/app/build/libs/app.jar
 *   ASSIST_REAL=http://127.0.0.1:18080 npx playwright test tests/assist-real.spec.ts
 *
 * Or against production, where the pages are served by the same host as the API (nothing to redirect):
 *
 *   E2E_URL=https://<cloudfront> npx playwright test tests/assist-real.spec.ts
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, pressXR, type Win } from './helpers.js';

const SERVER = process.env.ASSIST_REAL;
const PRODUCTION = process.env.E2E_URL;
test.skip(!SERVER && !PRODUCTION, 'set ASSIST_REAL=http://127.0.0.1:<port> (a local server) or E2E_URL=https://<host> (production)');
test.use(PRODUCTION && !SERVER ? { baseURL: PRODUCTION } : {});

test.beforeEach(async ({ context }) => {
  // Neither the first-run coach nor the guided setup in the way. (playwright.config.ts seeds "calibrated" for localhost only;
  // on production a new visitor would get the setup, and this panel would wait behind it, as it should.)
  await context.addInitScript(() => {
    localStorage.setItem('spatialdesk.onboarded', '1');
    localStorage.setItem('spatialdesk.calibrated', '1');
  });
  if (!SERVER) return; // production: the page and its API share a host
  // Every /api call of both pages goes to the real server (the preview server proxies to port 8080 only).
  await context.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: `${SERVER}${url.pathname}${url.search}` });
  });
});

const helperStage = (page: Page, stage: string) => page.waitForFunction((stage) => (window as Win).__helper?.view.stage === stage, stage, { timeout: 15_000 });

test('the real server: invite, code, Allow, board, a card added, Help opens the setup, it finishes, Stop ends it', async ({ context, page }) => {
  test.setTimeout(150_000);
  // Against production the console must stay clean too: no failed polling, no errors from either page.
  const consoleErrors: string[] = [];
  const watch = (p: Page) => p.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
  watch(page);
  const errors = await enterXR(page, '&fast');
  await page.evaluate(() => (window as Win).__voice.say('invite a helper'));
  await helperStage(page, 'inviting');
  const code = await page.evaluate(() => (window as Win).__helper.state.code as string);
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4} [A-HJ-NP-Z2-9]{4}$/);

  const carer = await context.newPage();
  const carerErrors: string[] = [];
  carer.on('pageerror', (e) => carerErrors.push(e.message));
  watch(carer);
  await carer.goto('/companion.html');
  await carer.locator('#code').fill(code);
  await carer.locator('#connect').click();
  await expect(carer.locator('h2')).toHaveText('Waiting for them to allow it');
  await expect(carer.locator('#board')).toHaveCount(0);
  await helperStage(page, 'asking');

  await page.bringToFront();
  await pressXR(page, 'helper:a'); // Allow
  await helperStage(page, 'sharing');
  await expect(carer.locator('#board')).toContainText('Tap a card to pick it up', { timeout: 15_000 });

  await page.evaluate(() => {
    const ws = (window as Win).__workspace;
    ws.dispatch({ op: 'add_card', board: ws.state.focusBoardId ?? ws.state.boards[0].id, title: 'Call mum' });
  });
  await expect(carer.locator('#board')).toContainText('Call mum', { timeout: 15_000 });

  await carer.bringToFront();
  await carer.locator('#help').click();
  await page.waitForFunction(() => (window as Win).__setup.view.stage === 'where', null, { timeout: 15_000 });
  await expect(carer.locator('#help-status')).toContainText('showing the setup', { timeout: 15_000 });
  await page.evaluate(() => (window as Win).__setup.choose('a'));
  await page.waitForFunction(() => (window as Win).__setup.view.stage === 'reach');
  await page.evaluate(() => (window as Win).__setup.choose('a'));
  await page.waitForFunction(() => (window as Win).__setup.view.stage === 'steady');
  await page.evaluate(() => (window as Win).__setup.choose('b'));
  await page.evaluate(() => (window as Win).__setup.choose('a'));
  await expect(carer.locator('#help-status')).toContainText('finished the setup', { timeout: 15_000 });

  await page.bringToFront();
  await page.waitForFunction(() => (window as Win).__helper.view.open && (window as Win).__helper.view.a === 'Stop sharing');
  // While it is shared, polling every two seconds from both sides, the console has said nothing wrong.
  const whileSharing = [...consoleErrors];
  await pressXR(page, 'helper:a'); // Stop sharing
  await helperStage(page, 'ended');
  await expect(carer.locator('h2')).toHaveText('This session has ended', { timeout: 15_000 });

  // The code is dead for anyone: a third screen is told so.
  const late = await context.newPage();
  await late.goto('/companion.html');
  await late.locator('#code').fill(code);
  await late.locator('#connect').click();
  await expect(late.locator('#code-error')).toContainText('not valid or has expired');
  expect(errors).toEqual([]);
  expect(carerErrors).toEqual([]);
  if (PRODUCTION && !SERVER) {
    expect(whileSharing, 'no console errors on production while it is shared, polling included').toEqual([]);
    // The end itself is signalled by a 404 on the carer's next poll (and on the dead code): the browser notes each one.
    expect(consoleErrors.slice(whileSharing.length).filter((text) => !/status of 404/.test(text)), 'after the end, nothing but those 404s').toEqual([]);
  }
});
