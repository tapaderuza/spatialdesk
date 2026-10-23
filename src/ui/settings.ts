/**
 * Accessibility and comfort settings, remembered per browser: high contrast, interface sounds, reading the agent's
 * words aloud (always also shown as text: the card is the caption) and hands-free (look at a control and hold the
 * gaze to press it, src/ui/gaze.ts). Toggled from the command panel, or by voice.
 */
import { PanelUISystem, type World } from '@iwsdk/core';

export interface Settings {
  highContrast: boolean;
  sound: boolean;
  readAloud: boolean;
  handsFree: boolean;
  /** During a focus block, everything beyond arm's reach fades (src/studio/focus-bubble.ts). */
  focusDim: boolean;
  /** During a focus block, the companion calls you back when the gaze has wandered off the work (src/studio/wander.ts). */
  nudges: boolean;
}

const KEY = 'spatialdesk.settings';
const DEFAULTS: Settings = { highContrast: false, sound: true, readAloud: false, handsFree: false, focusDim: true, nudges: true };

function load(): Settings {
  let loaded: Settings;
  try {
    loaded = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    loaded = { ...DEFAULTS };
  }
  // ?handsfree: a link that starts hands-free, for someone who cannot reach the toggle with a hand.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('handsfree')) loaded.handsFree = true;
  return loaded;
}

export const settings: Settings = load();
const listeners = new Set<(s: Settings) => void>();

/** Flips a setting, or sets it to [value] ("turn contrast on" by voice); listeners hear of every call. */
export function toggleSetting(key: keyof Settings, value: boolean = !settings[key]): void {
  settings[key] = value;
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
