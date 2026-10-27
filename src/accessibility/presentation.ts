/** Display-only privacy: callers retain the original workspace text and render it again when the mode is off. */
import { accessPreferences } from './preferences.js';
import type { Board, Timer } from '../workspace/model.js';

export const HIDDEN_PRESENTATION_TEXT = 'Dato oculto';

/** Use only at the visible-content boundary, never in workspace operations or internal identifiers. */
export function presentationText(text: string, enabled = accessPreferences.presentationMode): string {
  return enabled ? HIDDEN_PRESENTATION_TEXT : text;
}

/** A text-only view; no workspace object or nested array is changed or returned. */
export function boardPresentation(board: Board, enabled = accessPreferences.presentationMode) {
  return {
    title: presentationText(board.title, enabled),
    columns: board.columns.map(column => ({
      title: presentationText(column.title, enabled),
      cards: column.cards.map(card => presentationText(card.title, enabled)),
    })),
  };
}

/** Status and countdown stay useful while the user-provided label is hidden. */
export function timerPresentationLabel(timer: Timer, enabled = accessPreferences.presentationMode): string {
  const label = presentationText(timer.label, enabled);
  return timer.state === 'paused' ? `${label} - paused` : label;
}
