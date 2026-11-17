/**
 * Timing and comfort the person sets themselves (WCAG 2.2.1 Timing Adjustable; XAUR REQ 15b and 18a): how long a held
 * gaze takes to press, how long one-switch scanning lights each control, less motion and mono audio. By voice, or by
 * a link set up by whoever helps (src/accessibility/preferences.ts). And ?fps, the frame rate on the command panel,
 * so a tester on a real headset can read it off (src/perf/frame-meter.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import { GAZE_STEPS_MS, readAccessPreferences, SCAN_STEPS_MS, stepTiming } from '../src/accessibility/preferences.js';
import { FrameMeter } from '../src/perf/frame-meter.js';
import { parseCommand } from '../src/voice/commands.js';
import { enterXR, lookAt, openWorkspace, type Win } from './helpers.js';

const say = (page: Page, words: string) => page.evaluate((w) => (window as Win).__voice.say(w), words);
const notice = (page: Page) => page.evaluate(() => ((window as Win).__notice?.text ?? '') as string);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.access-preferences') ?? '{}'));
const noStorage = { getItem: () => null, setItem() {}, removeItem() {} };

test('the words: slower or faster gaze and scan, less motion, mono audio, in English and Spanish', () => {
  expect(parseCommand('Slower gaze.')).toEqual({ kind: 'timing', what: 'gaze', slower: true });
  expect(parseCommand('gaze faster')).toEqual({ kind: 'timing', what: 'gaze', slower: false });
  expect(parseCommand('longer dwell time')).toEqual({ kind: 'timing', what: 'gaze', slower: true });
  expect(parseCommand('Mirada más lenta')).toEqual({ kind: 'timing', what: 'gaze', slower: true });
  expect(parseCommand('slower scan')).toEqual({ kind: 'timing', what: 'scan', slower: true });
  expect(parseCommand('barrido más rápido')).toEqual({ kind: 'timing', what: 'scan', slower: false });
  expect(parseCommand('less motion on')).toEqual({ kind: 'access', key: 'reducedMotion', value: true });
  expect(parseCommand('menos movimiento')).toEqual({ kind: 'access', key: 'reducedMotion' });
  expect(parseCommand('mono audio off')).toEqual({ kind: 'access', key: 'monoAudio', value: false });
  expect(parseCommand('audio mono')).toEqual({ kind: 'access', key: 'monoAudio' });
  // Their neighbours are unchanged.
  expect(parseCommand('switch mode on')).toEqual({ kind: 'switch', value: true });
  expect(parseCommand('sound off')).toEqual({ kind: 'setting', setting: 'sound', value: false });
});

test('the steps: one word moves one step, the ends hold, and a value between steps goes to the next one', () => {
  expect(stepTiming(GAZE_STEPS_MS, 1000, true)).toBe(1600);
  expect(stepTiming(GAZE_STEPS_MS, 1000, false)).toBe(700);
  expect(stepTiming(GAZE_STEPS_MS, 3200, true)).toBe(3200);
  expect(stepTiming(GAZE_STEPS_MS, 700, false)).toBe(700);
  expect(stepTiming(GAZE_STEPS_MS, 1200, true)).toBe(1600);
  expect(stepTiming(GAZE_STEPS_MS, 1200, false)).toBe(1000);
  expect(stepTiming(SCAN_STEPS_MS, 1500, true)).toBe(2500);
});

test('a link set up by a helper: ?dwell, ?scan, ?calm and ?mono; values out of range are ignored', () => {
  const global = globalThis as { location?: { search: string } };
  try {
    global.location = { search: '?dwell=2400&scan=2500&calm&mono' };
    expect(readAccessPreferences(noStorage)).toMatchObject({ dwellMs: 2400, readDwellMs: 3840, scanIntervalMs: 2500, reducedMotion: true, monoAudio: true });
    global.location = { search: '?dwell=90000&scan=abc' };
    expect(readAccessPreferences(noStorage)).toMatchObject({ dwellMs: 1000, readDwellMs: 1600, scanIntervalMs: 1500, reducedMotion: false, monoAudio: false });
  } finally {
    delete global.location;
  }
});

test('by voice in the app: the gaze waits longer, the scan slows, motion and stereo turn off, each said back', async ({ page }) => {
  const errors = await openWorkspace(page);
  await say(page, 'slower gaze');
  expect(await notice(page)).toContain('Gaze: a held look presses after 1.6 s.');
  expect(await stored(page)).toMatchObject({ dwellMs: 1600, readDwellMs: 2560 });
  for (let i = 0; i < 3; i++) await say(page, 'slower gaze');
  expect(await notice(page)).toContain('3.2 s (the slowest)');
  expect(await stored(page)).toMatchObject({ dwellMs: 3200, readDwellMs: 5120 });

  await say(page, 'barrido más lento');
  expect(await notice(page)).toContain('Switch scan: each control stays lit 2.5 s.');
  expect(await stored(page)).toMatchObject({ scanIntervalMs: 2500 });

  await say(page, 'less motion on');
  expect(await notice(page)).toContain('Less motion on');
  await say(page, 'mono audio');
  expect(await notice(page)).toContain('Mono audio on');
  expect(await stored(page)).toMatchObject({ reducedMotion: true, monoAudio: true });
  expect(errors).toEqual([]);
});

test('in the headset: with ?dwell=2400 a held gaze has not pressed at 1.5 s, and has by 2.4 s', async ({ page }) => {
  const errors = await enterXR(page, '&handsfree&dwell=2400');
  const timers = () => page.evaluate(() => (window as Win).__workspace.state.timers.length as number);
  await lookAt(page, 'command:focus-button');
  await page.waitForTimeout(1_500); // the default second has passed: nothing yet
  expect(await page.evaluate(() => (window as Win).__gaze.key)).toBe('focus');
  expect(await timers()).toBe(0);
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.length === 1, null, { timeout: 3_000 });
  expect(errors).toEqual([]);
});

test('the frame meter: frames per second and the slowest frame, once a second; a hidden tab is not a frame', () => {
  const meter = new FrameMeter();
  for (let i = 0; i < 60; i++) expect(meter.add(1 / 72, 72)).toBeNull();
  expect(meter.add(0.05, 72)).toBeNull(); // one dropped frame, inside the second
  let line: string | null = null;
  for (let i = 0; i < 20 && !line; i++) line = meter.add(1 / 72, 72);
  expect(line).toMatch(/^\d+ fps, slowest frame 50 ms \(display 72 Hz\)$/);
  expect(meter.add(5)).toBeNull();
});

test('?fps in the headset: the command panel shows the frame rate; without it the line stays hidden', async ({ page }) => {
  const errors = await enterXR(page, '&fps');
  const fpsLine = () =>
    page.evaluate(() => {
      let found: any = null;
      (window as Win).__world.scene.traverse((o: any) => {
        if (o.name === 'command:fps-line') found = o;
      });
      return { text: String(found?.properties.value.text ?? ''), display: String(found?.properties.value.display ?? '') };
    });
  await page.waitForFunction(
    () => {
      let text = '';
      (window as Win).__world.scene.traverse((o: any) => {
        if (o.name === 'command:fps-line') text = String(o.properties.value.text ?? '');
      });
      return /^\d+ fps, slowest frame \d+ ms/.test(text);
    },
    null,
    { timeout: 10_000 },
  );
  expect((await fpsLine()).display).toBe('flex');
  expect(errors).toEqual([]);

  await enterXR(page);
  expect((await fpsLine()).display).not.toBe('flex');
});
