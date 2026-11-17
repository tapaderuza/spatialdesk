/**
 * Read aloud reads a proposal in full (src/agent/agent-system.ts spokenProposal): the summary, every change with its
 * reason in the card's own words, and how to confirm. Someone who cannot read the card's small text hears all of it, and
 * nothing moves until they say or press Apply. The browser's speech is stubbed here; Nova's answer is mocked.
 */
import { expect, test } from '@playwright/test';
import { openWorkspace, type Win } from './helpers.js';

test('Read aloud: a proposal is heard in full, each change with its reason, then how to confirm', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __spoken: string[] };
    w.__spoken = [];
    const synth = {
      speak: (u: { text: string }) => w.__spoken.push(u.text),
      cancel: () => undefined, pause: () => undefined, resume: () => undefined, getVoices: () => [],
      speaking: false, pending: false, paused: false, addEventListener: () => undefined, removeEventListener: () => undefined,
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    localStorage.setItem('spatialdesk.settings', JSON.stringify({ readAloud: true }));
  });
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/agent/plan', (route) =>
    route.fulfill({
      json: {
        ok: true,
        summary: 'Closer and lower, so your neck can rest.',
        steps: [
          { op: { op: 'set_comfort', reach: 0.8 }, why: 'Closer: less reaching' },
          { op: { op: 'set_comfort', tiltDeg: -10 }, why: 'Lower: no looking up' },
        ],
        source: 'us.amazon.nova-2-lite-v1:0',
      },
    }),
  );
  const errors = await openWorkspace(page);
  await page.locator('#day-badday-0').click();
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.at(-1) ?? '');
  expect(spoken).toContain('Closer and lower, so your neck can rest.');
  expect(spoken).toMatch(/1\. Comfort: .+: Closer: less reaching\./);
  expect(spoken).toMatch(/2\. Comfort: .+: Lower: no looking up\./);
  expect(spoken).toContain('To confirm, say apply or press Apply. Nothing moves before that.');
  expect(errors).toEqual([]);
});

test('Read aloud on a browser with no speech: it says so plainly instead of a toggle that stays silent', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
  });
  const errors = await openWorkspace(page);
  await page.evaluate(() => (window as Win).__voice.say('read aloud on'));
  expect(await page.evaluate(() => (window as Win).__notice?.text)).toContain('Read aloud is not available in this browser');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.settings') ?? '{}').readAloud)).toBe(true);
  await page.evaluate(() => (window as Win).__voice.say('read aloud off'));
  expect(await page.evaluate(() => (window as Win).__notice?.text)).toBe('Read aloud off.');
  expect(errors).toEqual([]);
});
