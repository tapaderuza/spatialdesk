/**
 * The language the app speaks, reads aloud and listens for. English unless the person chose another one: the browser's
 * own language is not a choice (a headset set to Spanish is not a person who asked for Spanish), so a judge, a carer or
 * a new user always starts in English. Spanish, French and the rest are one of:
 *   - the link: ?lang=es-ES (a bookmark for someone who always uses Spanish; never stored), or
 *   - the person's word: "speak Spanish" / "habla español" (src/voice/commands.ts), remembered in this browser.
 * The list mirrors what the command server lets Amazon Transcribe stream (TranscribePresigner.LANGUAGES); a short code
 * ("es") becomes its usual region ("es-ES").
 */
export const DEFAULT_LANGUAGE = 'en-US';

export const LANGUAGES = ['en-US', 'en-GB', 'en-AU', 'es-ES', 'es-US', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR'] as const;
const REGION: Record<string, string> = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-BR' };
const KEY = 'spatialdesk.language';

/** A supported tag for [tag] ("es", "ES_es", "es-ES"), or null when it is none of them. */
export function normaliseLanguage(tag: string | null | undefined): string | null {
  const cleaned = (tag ?? '').trim().replace('_', '-').toLowerCase();
  if (!cleaned) return null;
  const exact = LANGUAGES.find((known) => known.toLowerCase() === cleaned);
  return exact ?? REGION[cleaned.split('-')[0]] ?? null;
}

function fromLink(): string | null {
  return typeof location === 'undefined' ? null : normaliseLanguage(new URLSearchParams(location.search).get('lang'));
}

function fromStore(): string | null {
  try {
    return normaliseLanguage(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

let current = fromLink() ?? fromStore() ?? DEFAULT_LANGUAGE;
const listeners = new Set<(tag: string) => void>();

/** The BCP-47 tag in use: what Transcribe listens for and what speech synthesis reads aloud in. */
export function language(): string {
  return current;
}

export function isSpanish(): boolean {
  return current.startsWith('es');
}

/** False for a language the app does not know. Remembered in this browser; a link's ?lang= is only the start. */
export function setLanguage(tag: string): boolean {
  const next = normaliseLanguage(tag);
  if (!next) return false;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode: it holds for this visit */
  }
  for (const listener of listeners) listener(next);
  return true;
}

export function onLanguage(listener: (tag: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
