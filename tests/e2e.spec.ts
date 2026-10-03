/**
 * End-to-end smoke test: the WebXR app gets a session from the command server, opens the WebSocket, syncs
 * its clock (Kotlin ClockSync running in the browser) and keeps it while in XR.
 * Local: `npm run test:e2e` (starts the Spring Boot jar). Production: `E2E_URL=https://<cloudfront> npm run test:e2e`.
 */
import { expect, test } from '@playwright/test';

const target = process.env.E2E_URL;

test.use(target ? { baseURL: target } : {});

test('app connects to the command server and syncs its clock', async ({ page }) => {
  test.skip(!process.env.E2E && !target, 'end-to-end only (E2E=1 or E2E_URL)');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(target ? '/?emulate' : '/?emulate&perf');
  await page.waitForFunction(() => (window as any).__link?.kind === 'online', null, { timeout: 60_000 });
  await page.waitForFunction(() => (window as any).__link?.clockSynced === true, null, { timeout: 30_000 });
  const link = await page.evaluate(() => (window as any).__link);
  console.log('E2E LINK', JSON.stringify(link));

  expect(link.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(link.rttMs).toBeGreaterThanOrEqual(0);
  expect(link.rttMs).toBeLessThan(target ? 1500 : 200);
  expect(errors).toEqual([]);
});
