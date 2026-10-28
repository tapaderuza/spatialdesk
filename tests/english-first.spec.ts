/**
 * English first: a judge opens the app on a browser or headset set to any language and gets English; the voice listens
 * for US English and the English phrases work ("Put it within my reach", "I'm on the sofa", "Undo"). Spanish is
 * something the link (?lang=es-ES) or the person ("speak Spanish") asks for, and then it is Spanish everywhere.
 */
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_LANGUAGE, normaliseLanguage } from '../src/i18n/language.js';
import { parseCommand } from '../src/voice/commands.js';
import { enterXR, openWorkspace, tap, type Win } from './helpers.js';

// Listening asks for the microphone first: Chromium's fake one, as in tests/voice.spec.ts.
test.use({
  launchOptions: {
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('the language module: English by default, a short code gets its region, a stranger gets nothing', () => {
  expect(DEFAULT_LANGUAGE).toBe('en-US');
  expect(normaliseLanguage('es')).toBe('es-ES');
  expect(normaliseLanguage('ES_es')).toBe('es-ES');
  expect(normaliseLanguage('en-gb')).toBe('en-GB');
  expect(normaliseLanguage('fr')).toBe('fr-FR');
  expect(normaliseLanguage('pt')).toBe('pt-BR');
  expect(normaliseLanguage('ja')).toBeNull();
  expect(normaliseLanguage('')).toBeNull();
  expect(normaliseLanguage(null)).toBeNull();
});

test('English voice phrases: reach, sofa, undo, recalibrate; and the language by voice', () => {
  for (const said of ['Put it within my reach', 'Put it within my reach, please.', 'Put everything in my reach', 'Bring it within reach', 'Within my reach', 'Fit it within my reach', 'Place the board in my arm’s reach']) {
    expect(parseCommand(said), said).toEqual({ kind: 'reach' });
  }
  for (const said of ["I'm on the sofa", 'I am on the couch.', "I'm in bed", "I'm lying on the sofa, please"]) {
    expect(parseCommand(said), said).toEqual({ kind: 'fit', low: true });
  }
  for (const said of ['Undo', 'Undo that', 'undo please', 'Undo the last step']) expect(parseCommand(said), said).toEqual({ kind: 'undo' });
  for (const said of ['Recalibrate', 'Calibrate my space', 'Guided setup', 'Set me up', 'Start the guided setup', 'Recalibrar']) {
    expect(parseCommand(said), said).toEqual({ kind: 'calibrate' });
  }
  expect(parseCommand('Speak Spanish')).toEqual({ kind: 'language', tag: 'es-ES' });
  expect(parseCommand('Switch to English, please')).toEqual({ kind: 'language', tag: 'en-US' });
  expect(parseCommand('Habla en español')).toEqual({ kind: 'language', tag: 'es-ES' });
  expect(parseCommand('en inglés')).toEqual({ kind: 'language', tag: 'en-US' });
  // Longer requests are still the agent's to read, never a command by accident.
  expect(parseCommand('Put the report in my reach and start a timer')?.kind).toBe('ask');
  expect(parseCommand('Plan my day in Spanish')?.kind).not.toBe('language');
});

test('in XR, "Put it within my reach" starts measuring, "cancel" stops it, and "Undo" takes a change back', async ({ page }) => {
  const errors = await enterXR(page);
  const say = (said: string) => page.evaluate((s) => (window as Win).__voice.say(s), said);
  const measuring = () => page.evaluate(() => (window as Win).__reach.view.measuring);
  await say('Put it within my reach');
  expect(await measuring()).toBe(true);
  await say('cancel');
  expect(await measuring()).toBe(false);

  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'set_comfort', reach: 0.8 }));
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort.reach)).toBe(0.8);
  await say('Undo');
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort.reach)).toBe(1);
  expect(errors).toEqual([]);
});

/** The language the app asks Transcribe for, read from the voice session request the Talk button makes. */
async function askedLanguages(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/voice/session', async (route) => {
    asked.push(route.request().postDataJSON().language);
    await route.fulfill({ status: 503, json: { ok: false, error: 'stand-in' } }); // only the request matters here
  });
  return asked;
}

test.describe('a browser set to Spanish', () => {
  test.use({ locale: 'es-ES' });

  test('still gets English and US English listening; "speak Spanish" changes both, and it is remembered', async ({ page }) => {
    const asked = await askedLanguages(page);
    expect(await page.evaluate(() => navigator.language)).toBe('es-ES'); // the browser really says Spanish
    const errors = await openWorkspace(page);
    await page.waitForFunction(() => (window as Win).__link?.kind === 'online' || (window as Win).__link?.kind === 'connecting');
    await tap(page, 'command:talk-button');
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toBe('en-US');

    await page.evaluate(() => (window as Win).__voice.say('speak Spanish'));
    await tap(page, 'command:talk-button');
    await expect.poll(() => asked.length).toBe(2);
    expect(asked[1]).toBe('es-ES');
    expect(await page.evaluate(() => localStorage.getItem('spatialdesk.language'))).toBe('es-ES');

    await page.reload();
    await openWorkspace(page);
    await tap(page, 'command:talk-button');
    await expect.poll(() => asked.length).toBe(3);
    expect(asked[2]).toBe('es-ES'); // a person who asked for Spanish keeps it on this browser

    await page.evaluate(() => (window as Win).__voice.say('habla inglés'));
    await tap(page, 'command:talk-button');
    await expect.poll(() => asked.length).toBe(4);
    expect(asked[3]).toBe('en-US');
    expect(errors).toEqual([]);
  });

  test('the link chooses Spanish for someone who always uses it, and stores nothing', async ({ page }) => {
    const asked = await askedLanguages(page);
    await openWorkspace(page, '?lang=es-ES');
    await page.waitForFunction(() => (window as Win).__link?.kind === 'online' || (window as Win).__link?.kind === 'connecting');
    await tap(page, 'command:talk-button');
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toBe('es-ES');
    expect(await page.evaluate(() => localStorage.getItem('spatialdesk.language'))).toBeNull();
  });
});

test('an English browser asking for a language the app does not have still gets English', async ({ page }) => {
  const asked = await askedLanguages(page);
  await openWorkspace(page, '?lang=tlh');
  await page.waitForFunction(() => (window as Win).__link?.kind === 'online' || (window as Win).__link?.kind === 'connecting');
  await tap(page, 'command:talk-button');
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe('en-US');
});
