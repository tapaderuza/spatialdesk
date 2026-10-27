import { expect, test } from '@playwright/test';
import {
  accessPreferences, onAccessPreferences, resetAccessPreferences, setAccessPreference,
} from '../src/accessibility/preferences.js';
import {
  boardPresentation, HIDDEN_PRESENTATION_TEXT, presentationText, timerPresentationLabel,
} from '../src/accessibility/presentation.js';
import { companionBounce, companionFlash, companionTime } from '../src/studio/companion-motion.js';
import type { Workspace } from '../src/workspace/model.js';

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) frozen(nested);
    Object.freeze(value);
  }
  return value;
}

const state: Workspace = frozen({
  schema: 1, revision: 8, nextId: 19,
  anchor: { x: 0, y: 1, z: -1, yaw: 0, pitch: 0 },
  focusBoardId: 'board-private-id',
  boards: [{
    id: 'board-private-id', title: 'Proyecto familiar de Ana',
    pose: { x: 0, y: 1.4, z: -0.8, yaw: 0, pitch: 0 },
    columns: [{ id: 'column-private-id', title: 'Próxima cita', cards: [
      { id: 'card-private-id', title: 'Llamar a Elena a las 18:00', priority: 'high', minutes: 25, since: 123 },
    ] }],
  }],
  timers: [{
    id: 'timer-private-id', label: 'Escribir a Elena', durationMs: 60_000,
    remainingMs: 45_000, state: 'paused', cardId: 'card-private-id',
    pose: { x: 0.5, y: 1.3, z: -0.8, yaw: 0, pitch: 0 },
  }],
  comfort: { reach: 1, scale: 1, side: 'both', turnDeg: 120, tiltDeg: 0 },
  view: { halfWidthDeg: 40, upDeg: 30, downDeg: 30 },
});

test.afterEach(() => resetAccessPreferences());

test('presentation: board and timer rendering hides user content without changing IDs, tasks, timing or poses', () => {
  const before = JSON.stringify(state);
  const projected = boardPresentation(state.boards[0], true);
  expect(projected).toEqual({ title: 'Dato oculto', columns: [{ title: 'Dato oculto', cards: ['Dato oculto'] }] });
  expect(timerPresentationLabel(state.timers[0], true)).toBe('Dato oculto - paused');
  expect(JSON.stringify(projected)).not.toContain('Elena');
  expect(JSON.stringify(projected)).not.toContain('private-id');
  expect(JSON.stringify(state)).toBe(before);
  expect(state.boards[0].columns[0].cards[0]).toMatchObject({ id: 'card-private-id', priority: 'high', minutes: 25, since: 123 });
  expect(state.timers[0]).toMatchObject({ id: 'timer-private-id', remainingMs: 45_000, state: 'paused', cardId: 'card-private-id' });
  expect(projected.columns).not.toBe(state.boards[0].columns);
});

test('presentation: disabling the mode restores exact current labels, including updates made while hidden', () => {
  resetAccessPreferences();
  let current = state;
  let visible = boardPresentation(current.boards[0]);
  let timerLabel = timerPresentationLabel(current.timers[0]);
  const stop = onAccessPreferences(() => {
    visible = boardPresentation(current.boards[0]);
    timerLabel = timerPresentationLabel(current.timers[0]);
  });
  const before = JSON.stringify(current);
  try {
    expect(setAccessPreference('presentationMode', true)).toBe(true);
    expect(visible.title).toBe(HIDDEN_PRESENTATION_TEXT);
    expect(visible.columns[0].cards[0]).toBe(HIDDEN_PRESENTATION_TEXT);
    expect(timerLabel).toBe('Dato oculto - paused');
    expect(JSON.stringify(current)).toBe(before);

    current = frozen({
      ...state,
      boards: [{ ...state.boards[0], title: 'Última revisión de Ana' }],
      timers: [{ ...state.timers[0], label: 'Revisión nueva', state: 'running' }],
    });
    const updated = JSON.stringify(current);
    expect(boardPresentation(current.boards[0]).title).toBe(HIDDEN_PRESENTATION_TEXT);
    expect(setAccessPreference('presentationMode', false)).toBe(true);
    expect(visible.title).toBe('Última revisión de Ana');
    expect(visible.columns[0].title).toBe('Próxima cita');
    expect(visible.columns[0].cards[0]).toBe('Llamar a Elena a las 18:00');
    expect(timerLabel).toBe('Revisión nueva');
    expect(JSON.stringify(current)).toBe(updated);
  } finally {
    stop();
  }
});

test('presentation: default copy stays exact and privacy does not depend on the text format', () => {
  resetAccessPreferences();
  expect(accessPreferences.presentationMode).toBe(false);
  const privateText = 'Ana\nhttps://example.invalid/private?name=Ana\t"Señal"';
  expect(presentationText(privateText)).toBe(privateText);
  expect(presentationText(privateText, true)).toBe(HIDDEN_PRESENTATION_TEXT);
  expect(timerPresentationLabel({ ...state.timers[0], state: 'done' }, true)).toBe(HIDDEN_PRESENTATION_TEXT);
  expect(timerPresentationLabel(state.timers[0], false)).toBe('Escribir a Elena - paused');
});

test('reduced motion: the original companion bob and celebration curves stay exact by default', () => {
  resetAccessPreferences();
  expect(accessPreferences.reducedMotion).toBe(false);
  for (const time of [0, 0.25, 1, 18.75]) {
    expect(companionTime(time, false)).toBe(time);
    for (const celebration of [-Infinity, 0, 0.25, 0.5, 1, 1.2]) {
      const celebrating = celebration > 0 && celebration < 1;
      for (const calling of [true, false]) {
        expect(companionBounce(time, celebration, calling, false)).toBe(
          celebrating ? Math.sin(Math.PI * celebration) : calling ? 0.3 * Math.max(0, Math.sin(time * 5)) : 0,
        );
      }
      expect(companionFlash(celebration, false)).toBe(celebrating ? 0.6 * (1 - celebration) : 0);
    }
  }
});

test('reduced motion: the shader clock, idle drift, calling bob and celebration flash are stable', () => {
  for (const time of [0, 0.25, 1, 18.75]) {
    const shaderTime = companionTime(time, true);
    expect(shaderTime).toBe(0);
    // The existing shader's idle displacement is sin(uTime * 0.9) * 0.004.
    expect(Math.sin(shaderTime * 0.9) * 0.004).toBe(0);
    for (const celebration of [-Infinity, 0, 0.25, 0.5, 1, 1.2]) {
      expect(companionBounce(time, celebration, true, true)).toBe(0);
      expect(companionBounce(time, celebration, false, true)).toBe(0);
      expect(companionFlash(celebration, true)).toBe(0);
    }
  }
});
