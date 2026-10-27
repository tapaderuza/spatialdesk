import { expect, test } from '@playwright/test';
import { SwitchAccess, type SwitchControl } from '../src/accessibility/switch-access.js';
import { accessPreferences, readAccessPreferences, resetAccessPreferences, setAccessPreference } from '../src/accessibility/preferences.js';

function key(target: EventTarget, value: string, type = 'keydown', repeat = false): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { key: value, code: value === ' ' ? 'Space' : value, repeat, ctrlKey: false, metaKey: false, altKey: false });
  target.dispatchEvent(event);
  return event;
}
function click(target: EventTarget, value = ' ') { key(target, value); key(target, value, 'keyup'); }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('switch preferences: defaults, ranges and unknown fields remain explicit', () => {
  resetAccessPreferences();
  expect(accessPreferences).toMatchObject({ switchEnabled: false, scanIntervalMs: 1500, reducedMotion: false, readingScale: 1, captionSize: 1, presentationMode: false });
  expect(setAccessPreference('switchEnabled', true)).toBe(true);
  expect(setAccessPreference('scanIntervalMs', 600)).toBe(true);
  expect(setAccessPreference('scanIntervalMs', 599)).toBe(false);
  expect(setAccessPreference('scanIntervalMs', 6001)).toBe(false);
  expect(setAccessPreference('scanIntervalMs', 1000.5)).toBe(false);
  expect(setAccessPreference('readingScale', 1.25)).toBe(true);
  expect(setAccessPreference('readingScale', 1.61)).toBe(false);
  expect(setAccessPreference('captionSize', 1.8)).toBe(true);
  expect(setAccessPreference('captionSize', 0.79)).toBe(false);
  expect(setAccessPreference('presentationMode', 'on' as never)).toBe(false);
  const clean = readAccessPreferences({ getItem: () => JSON.stringify({ readingScale: 0, scanIntervalMs: -20, reducedMotion: true, patient: 'private' }), setItem() {}, removeItem() {} });
  expect(clean).toMatchObject({ readingScale: 1, scanIntervalMs: 1500, reducedMotion: true });
  expect(clean).not.toHaveProperty('patient');
  resetAccessPreferences();
});

test('switch: first press arms; a later fresh press selects; holding or repeating cannot select', () => {
  const target = new EventTarget(), selected: string[] = [];
  const scanner = new SwitchAccess({ eventTarget: target });
  scanner.setSurface('home', [{ key: 'save', label: 'Save', activate: () => selected.push('save') }]);
  scanner.start();
  expect(scanner.snapshot()).toMatchObject({ running: true, armed: false, highlighted: null });
  key(target, ' ');
  expect(scanner.snapshot()).toMatchObject({ armed: true, highlighted: { key: 'save', label: 'Save' } });
  expect(selected).toEqual([]);
  expect(key(target, ' ', 'keydown', true).defaultPrevented).toBe(true);
  key(target, ' '); // some switch adapters send repeated keydown with repeat=false
  expect(selected).toEqual([]);
  key(target, ' ', 'keyup');
  key(target, 'Enter');
  expect(selected).toEqual(['save']);
  expect(scanner.snapshot().armed).toBe(false);
  key(target, 'Enter', 'keyup');
  scanner.dispose();
});

test('switch: a replacement under a held key always requires release, arm and a new selection', () => {
  const target = new EventTarget(), selected: string[] = [];
  const scanner = new SwitchAccess({ eventTarget: target });
  scanner.setSurface('proposal', [{ key: 'apply', label: 'Apply proposal', activate: () => {
    selected.push('proposal');
    scanner.setSurface('confirmation', [{ key: 'apply', label: 'Apply another change', activate: () => selected.push('replacement') }]);
  } }]);
  scanner.start();
  click(target);
  key(target, ' ');
  expect(selected).toEqual(['proposal']);
  key(target, ' ', 'keydown', true);
  key(target, ' ');
  expect(selected).toEqual(['proposal']);
  expect(scanner.snapshot().armed).toBe(false);
  key(target, ' ', 'keyup');
  click(target);
  expect(selected).toEqual(['proposal']);
  click(target);
  expect(selected).toEqual(['proposal', 'replacement']);
  scanner.dispose();
});

test('switch: automatic scanning uses one timer and cleanup prevents future highlights or actions', async () => {
  const target = new EventTarget(), highlighted: (string | null)[] = [], selected: string[] = [];
  const scanner = new SwitchAccess({ eventTarget: target, intervalMs: 600, onHighlight: c => highlighted.push(c?.key ?? null) });
  scanner.setSurface('choices', [{ key: 'a', label: 'A', activate: () => selected.push('a') }, { key: 'b', label: 'B', activate: () => selected.push('b') }]);
  scanner.start();
  click(target);
  await delay(700);
  expect(scanner.snapshot().highlighted?.key).toBe('b');
  scanner.stop();
  const count = highlighted.length;
  await delay(700);
  click(target);
  expect(highlighted).toHaveLength(count);
  expect(selected).toEqual([]);
  scanner.dispose();
  scanner.start();
  scanner.advance();
  scanner.setSurface('ignored', [{ key: 'bad', label: 'Bad', activate: () => selected.push('bad') }]);
  click(target);
  expect(scanner.snapshot()).toMatchObject({ disposed: true, running: false, armed: false, controlCount: 0 });
  expect(selected).toEqual([]);
});

test('switch: editable inputs retain Space, Enter and Escape; Escape elsewhere exits once', () => {
  const input = Object.assign(new EventTarget(), { tagName: 'INPUT' });
  const selected: string[] = [];
  const scanner = new SwitchAccess({ eventTarget: input, onEscape: () => selected.push('escape') });
  scanner.setSurface('form', [{ key: 'save', label: 'Save', activate: () => selected.push('save') }]);
  scanner.start();
  for (const value of [' ', 'Enter', 'Escape']) expect(key(input, value).defaultPrevented).toBe(false);
  expect(scanner.snapshot().armed).toBe(false);
  expect(selected).toEqual([]);
  input.tagName = 'DIV';
  expect(key(input, 'Escape').defaultPrevented).toBe(true);
  key(input, 'Escape');
  expect(selected).toEqual(['escape']);
  expect(scanner.snapshot().running).toBe(false);
  scanner.dispose();
});

test('switch: malformed or duplicate controls invalidate the old surface instead of leaving an active action', () => {
  const target = new EventTarget(), selected: string[] = [];
  const scanner = new SwitchAccess({ eventTarget: target });
  scanner.setSurface('old', [{ key: 'old', label: 'Old action', activate: () => selected.push('old') }]);
  scanner.start();
  click(target);
  expect(() => scanner.setSurface('bad', [{ key: 'duplicate', label: 'One', activate() {} }, { key: 'duplicate', label: 'Two', activate() {} }])).toThrow();
  click(target);
  expect(scanner.snapshot()).toMatchObject({ controlCount: 0, armed: false });
  expect(selected).toEqual([]);
  scanner.dispose();
  expect(() => new SwitchAccess({ intervalMs: 599 })).toThrow();
});

test('switch: changing content from a highlight callback cannot keep an old action or scan timer', () => {
  const target = new EventTarget(), selected: string[] = [];
  const scanner = new SwitchAccess({ eventTarget: target, onHighlight: control => {
    if (control?.key === 'old') scanner.setSurface('new', [{ key: 'new', label: 'New action', activate: () => selected.push('new') }]);
  } });
  scanner.setSurface('old', [{ key: 'old', label: 'Old action', activate: () => selected.push('old') }]);
  scanner.start();
  click(target);
  expect(scanner.snapshot()).toMatchObject({ surfaceId: 'new', armed: false });
  click(target);
  expect(selected).toEqual([]);
  click(target);
  expect(selected).toEqual(['new']);
  scanner.dispose();
});

test('switch: valid interval changes are applied without activating or replacing the highlighted control', async () => {
  resetAccessPreferences();
  const target = new EventTarget(), selected: string[] = [];
  const scanner = new SwitchAccess({ eventTarget: target });
  scanner.setSurface('choices', [{ key: 'a', label: 'A', activate: () => selected.push('a') }, { key: 'b', label: 'B', activate: () => selected.push('b') }]);
  scanner.start();
  click(target);
  setAccessPreference('scanIntervalMs', 600);
  expect(scanner.snapshot().highlighted?.key).toBe('a');
  await delay(700);
  expect(scanner.snapshot().highlighted?.key).toBe('b');
  expect(selected).toEqual([]);
  scanner.dispose();
  resetAccessPreferences();
});

test('switch: a newer surface supplied during reset wins over the interrupted old update', () => {
  let replace = true;
  const scanner = new SwitchAccess({ onHighlight: control => {
    if (!control && replace) {
      replace = false;
      scanner.setSurface('latest', [{ key: 'latest', label: 'Latest', activate() {} }]);
    }
  } });
  scanner.setSurface('old', [{ key: 'old', label: 'Old', activate() {} }]);
  expect(scanner.snapshot()).toMatchObject({ surfaceId: 'latest', controlCount: 1, armed: false });
  scanner.dispose();
});

test('switch: disposing cannot be undone by a highlight callback attempting to restart', () => {
  const target = new EventTarget(), actions: string[] = [];
  let restarting = false;
  const scanner = new SwitchAccess({ eventTarget: target, onHighlight: () => { if (restarting) scanner.start(); } });
  scanner.setSurface('home', [{ key: 'save', label: 'Save', activate: () => actions.push('save') }]);
  scanner.start();
  click(target);
  restarting = true;
  scanner.dispose();
  click(target); click(target);
  expect(scanner.snapshot()).toMatchObject({ disposed: true, running: false, controlCount: 0 });
  expect(actions).toEqual([]);
});
