import { expect, test } from '@playwright/test';
import {
  accessPreferences, DEFAULT_ACCESS_PREFERENCES, onAccessPreferences, readAccessPreferences,
  resetAccessPreferences, setAccessPreference, validAccessPreference,
} from '../src/accessibility/preferences.js';
import {
  beginCalibration, calibrationField, calibrationOps, nextCalibration, previousCalibration,
  restoreCalibration, setCalibrationValue,
} from '../src/accessibility/calibration.js';
import type { Comfort } from '../src/workspace/model.js';
import { enterXR, frames, lookAt, pressXR, restHands, turnHead, type Win } from './helpers.js';

const initial: Comfort = { reach: 1, scale: 1, side: 'both', turnDeg: 120, tiltDeg: 0 };

test('access preferences: defaults preserve current timing and mixed audio; unknown personal data is discarded', () => {
  const defaults = readAccessPreferences({ getItem: () => null, setItem() {}, removeItem() {} });
  expect(defaults).toEqual(DEFAULT_ACCESS_PREFERENCES);
  expect(defaults).toMatchObject({ dwellMs: 1000, readDwellMs: 1600, settleMs: 150, tremorTolerance: false, cuesVolume: 1, ambienceVolume: 1, monoAudio: false, listenMaxMs: 20_000 });
  const source = { getItem: () => JSON.stringify({ dwellMs: 2500, monoAudio: true, diagnosis: 'must not survive', transcript: 'must not survive', cuesVolume: 2, settleMs: -1 }), setItem() {}, removeItem() {} };
  const prefs = readAccessPreferences(source);
  expect(prefs).toMatchObject({ dwellMs: 2500, monoAudio: true, cuesVolume: 1, settleMs: 150 });
  expect(prefs).not.toHaveProperty('diagnosis');
  expect(prefs).not.toHaveProperty('transcript');
  expect(readAccessPreferences({ ...source, getItem: () => '{broken' })).toEqual(defaults);
});

test('access preferences: bounds reject invalid settings; listeners tear down; reset keeps object identity', () => {
  resetAccessPreferences();
  const original = accessPreferences;
  const heard: number[] = [];
  const unsubscribe = onAccessPreferences(p => heard.push(p.dwellMs));
  expect(setAccessPreference('dwellMs', 2400)).toBe(true);
  expect(setAccessPreference('dwellMs', 399)).toBe(false);
  expect(setAccessPreference('dwellMs', 2400.5)).toBe(false);
  expect(setAccessPreference('dwellMs', Infinity)).toBe(false);
  expect(setAccessPreference('monoAudio', 'true' as never)).toBe(false);
  expect(setAccessPreference('speechRate', 1.25)).toBe(true);
  expect(setAccessPreference('voiceVolume', 0)).toBe(true);
  expect(validAccessPreference('listenPauseMs', 6001)).toBe(false);
  expect(validAccessPreference('listenMaxMs', 60_000)).toBe(true);
  unsubscribe();
  const calls = heard.length;
  resetAccessPreferences();
  expect(heard).toHaveLength(calls);
  expect(accessPreferences).toBe(original);
  expect(accessPreferences).toEqual(DEFAULT_ACCESS_PREFERENCES);
});

test('calibration: navigation and restore preserve the original; every changed setting is a separate proposal', () => {
  const session = beginCalibration(initial);
  expect(calibrationOps(session)).toEqual([]);
  const closer = setCalibrationValue(session, 'reach', 0.8)!;
  const larger = setCalibrationValue(closer, 'scale', 1.4)!;
  const right = setCalibrationValue(larger, 'side', 'right')!;
  expect(initial).toEqual({ reach: 1, scale: 1, side: 'both', turnDeg: 120, tiltDeg: 0 });
  expect(session.draft).toEqual(initial);
  expect(calibrationOps(right)).toEqual([{ op: 'set_comfort', reach: 0.8 }, { op: 'set_comfort', scale: 1.4 }, { op: 'set_comfort', side: 'right' }]);
  expect(calibrationField(nextCalibration(right))).toBe('scale');
  expect(previousCalibration(right).step).toBe(0);
  let last = right;
  for (let i = 0; i < 10; i++) last = nextCalibration(last);
  expect(calibrationField(last)).toBe('review');
  expect(restoreCalibration(last).draft).toEqual(initial);
  expect(calibrationOps(restoreCalibration(last))).toEqual([]);
});

test('calibration: workspace bounds and unknown fields cannot become proposed operations', () => {
  const session = beginCalibration(initial);
  expect(setCalibrationValue(session, 'reach', 0.49)).toBeNull();
  expect(setCalibrationValue(session, 'scale', 1.81)).toBeNull();
  expect(setCalibrationValue(session, 'side', 'north' as never)).toBeNull();
  expect(setCalibrationValue(session, 'turnDeg', 19)).toBeNull();
  expect(setCalibrationValue(session, 'tiltDeg', 31)).toBeNull();
  expect(setCalibrationValue(session, 'reach', NaN)).toBeNull();
  expect(setCalibrationValue(session, 'diagnosis' as never, 'x' as never)).toBeNull();
  expect(() => beginCalibration({ ...initial, reach: 0 })).toThrow();
  expect(() => calibrationOps({ ...session, draft: { ...initial, scale: 20 } })).toThrow();
});

test('accessibility: a deliberately slow dwell waits, selects once, and does not repeat while held', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.access-preferences', JSON.stringify({ dwellMs: 3000, settleMs: 0 })));
  const errors = await enterXR(page);
  await pressXR(page, 'coach:coach-skip');
  await restHands(page);
  await page.evaluate(() => (window as Win).__voice.say('hands free on'));
  await lookAt(page, 'command:arrange-button');
  const before = await page.evaluate(() => (window as Win).__gaze.presses);
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => (window as Win).__gaze.presses)).toBe(before);
  await page.waitForFunction(n => (window as Win).__gaze.presses === n + 1, before, { timeout: 4500 });
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as Win).__gaze.presses)).toBe(before + 1);
  await turnHead(page, 0, -70);
  await page.evaluate(() => (window as Win).__voice.say('hands free off'));
  expect(errors).toEqual([]);
});

test('accessibility: cue and ambience preferences are independent and mono reaches the audio graph', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.access-preferences', JSON.stringify({ cuesVolume: 0.25, ambienceVolume: 0, monoAudio: true })));
  const errors = await enterXR(page);
  await pressXR(page, 'coach:coach-skip');
  await pressXR(page, 'command:focus-button');
  await frames(page, 10);
  const mix = await page.evaluate(() => (window as Win).__sound.mix());
  expect(mix.cues).toBeCloseTo(0.25, 2);
  expect(mix.ambience).toBe(0);
  expect(mix.channels).toBe(1);
  expect(await page.evaluate(() => (window as Win).__sound.ambienceOn())).toBe(false);
  expect(errors).toEqual([]);
});

test('accessibility: brief loss of gaze freezes progress and never selects while off target', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.access-preferences', JSON.stringify({ dwellMs: 1500, settleMs: 0, tremorTolerance: true, targetGraceMs: 600 })));
  const errors = await enterXR(page);
  await pressXR(page, 'coach:coach-skip');
  await restHands(page);
  await page.evaluate(() => (window as Win).__voice.say('hands free on'));
  await lookAt(page, 'command:arrange-button');
  await page.waitForTimeout(650);
  const before = await page.evaluate(() => ({ ...(window as Win).__gaze }));
  expect(before.key).toBe('arrange');
  await turnHead(page, 0, -80);
  await page.waitForTimeout(60);
  const off = await page.evaluate(() => ({ ...(window as Win).__gaze }));
  await page.waitForTimeout(60);
  const held = await page.evaluate(() => ({ ...(window as Win).__gaze }));
  expect(held.presses).toBe(before.presses);
  expect(held.progress).toBeCloseTo(off.progress, 2);
  await lookAt(page, 'command:arrange-button');
  expect(await page.evaluate(() => (window as Win).__gaze.progress)).toBeGreaterThan(0.3);
  await page.waitForFunction(n => (window as Win).__gaze.presses === n + 1, before.presses, { timeout: 2500 });
  await turnHead(page, 0, -80);
  await page.evaluate(() => (window as Win).__voice.say('hands free off'));
  expect(errors).toEqual([]);
});
