/**
 * Accessibility and comfort settings, remembered per browser: high contrast, interface sounds, and reading the
 * agent's words aloud (always also shown as text: the card is the caption). Toggled from the command panel.
 */
import { PanelUISystem, type World } from '@iwsdk/core';

export interface Settings {
  highContrast: boolean;
  sound: boolean;
  readAloud: boolean;
}

const KEY = 'spatialdesk.settings';
const DEFAULTS: Settings = { highContrast: false, sound: true, readAloud: false };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export function toggleSetting(key: keyof Settings): void {
  settings[key] = !settings[key];
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // private mode: the setting lasts for this visit only
  }
  applyColorScheme();
  for (const listener of listeners) listener(settings);
}

export function onSettings(listener: (s: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let world: World | null = null;

/** Call once the world exists: from then on the colour scheme follows the high-contrast setting. */
export function bindColorScheme(w: World): void {
  world = w;
  applyColorScheme();
}

/**
 * High contrast rides on UIKit's "dark" conditional: every UIKitML file states its high-contrast colours in :dark
 * sections, and this one switch flips them all. It goes through IWSDK's PanelUISystem (which owns the scheme and
 * defaults to "system") and is always explicit, so an operating system in dark mode cannot turn it on by accident.
 */
function applyColorScheme(): void {
  const panels = world?.getSystem(PanelUISystem);
  if (panels) panels.config.preferredColorScheme.value = settings.highContrast ? 'dark' : 'light';
}

/**
 * Colours painted at runtime (borders of cards and buttons, states) cannot use :dark, which would outrank them.
 * In high contrast every idle control gets a white outline, so every target is visible at a glance.
 */
export function idleBorder(normal: string): string {
  return settings.highContrast ? '#ffffff' : normal;
}
