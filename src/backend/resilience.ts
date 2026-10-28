/**
 * What the interface does when the network or the AI lets it down: it does not wait forever. The AI (Amazon Nova) and
 * the voice (Amazon Transcribe) get [AI_PATIENCE_MS]; after that, or on a network error, the "thinking" or "listening"
 * state ends and one calm line says so. The cards never depended on either: the hands keep working throughout.
 */
import { isSpanish } from '../i18n/language.js';

/** The whole wait for one AI request or one voice connection, from the press to the answer. */
export const AI_PATIENCE_MS = 7_000;

/** The single notice for "the network or the AI is out of reach": plain, not an alarm. ASCII only (panel font). */
export function manualModeNotice(): string {
  return isSpanish() ? 'Problema de red. Modo manual activado.' : 'Network issue. Switched to manual mode.';
}
