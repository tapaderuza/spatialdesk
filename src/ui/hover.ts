/**
 * Hover as Meta's eye-tracking guidance asks (developers.meta.com/vr/design/eyes-best-practices): the control itself
 * turns a little lighter, with no outline (an outline pulls the eyes to the edge, away from the centre they aim at),
 * fading on over 300 ms and off over 400 ms, so a gaze sweeping across a panel leaves no flicker behind it. Eyes,
 * rays, pokes and the mouse all hover alike, through each panel's PanelHits. A card under a ray, or rested on by the
 * eyes, also wears a soft rim of light outside its edge (src/ui/rim.ts), which leaves its centre as it is.
 *
 * Paint code says what a control's idle colour is and whether it is hovered (hoverFades.paint); HoverSystem moves the
 * colour there. Each fade's colour steps are computed once per idle colour and reused, and a control is restyled only
 * when its step changes, so a running fade costs a comparison per frame and nothing at all once settled.
 */
import { createSystem, type UIKit } from '@iwsdk/core';

const ON_MS = 300;
const OFF_MS = 400;
const STEPS = 8;
/** How far the hovered tone moves from the idle colour toward the accent: visible, never loud. */
const LIFT = 0.2;
/** A card that is aimed at also rises a little toward the hand (3.5 % larger), with the same fade: it feels pickable. */
const RISE = 0.035;
const ACCENT = '#9cc3ff';

interface Fade {
  element: UIKit.Text;
  steps: readonly string[];
  level: number;
  target: 0 | 1;
  step: number;
  lastMs: number;
  /** Cards rise as well as lighten (see [RISE]); buttons only lighten. */
  rise: boolean;
}

const stepCache = new Map<string, readonly string[]>();

/** The idle colour, then STEPS tones toward the hovered one. */
function stepsFor(idle: string, toward: string): readonly string[] {
  const key = `${idle}>${toward}`;
  let steps = stepCache.get(key);
  if (!steps) {
    const from = rgb(idle);
    const to = rgb(toward);
    steps = Array.from({ length: STEPS + 1 }, (_, i) => {
      const t = (LIFT * i) / STEPS;
      return hex(from.map((c, k) => c + (to[k] - c) * t));
    });
    stepCache.set(key, steps);
  }
  return steps;
}

class HoverFades {
  /** Weak: a disposed panel's controls are forgotten with it. */
  private readonly fades = new WeakMap<UIKit.Text, Fade>();
  private readonly running: Fade[] = [];

  /**
   * Paints [element]'s background for its idle colour and hover state, fading from where it is now. [toward] tints
   * the hovered tone (a drop target lifts toward green); [rise] also scales it up a little (cards).
   */
  paint(element: UIKit.Text, idle: string, hovered: boolean, toward: string = ACCENT, rise = false): void {
    let fade = this.fades.get(element);
    const steps = stepsFor(idle, toward);
    if (!fade) {
      fade = { element, steps, level: 0, target: 0, step: -1, lastMs: performance.now(), rise };
      this.fades.set(element, fade);
    }
    fade.rise = rise;
    const restyle = fade.steps !== steps;
    fade.steps = steps;
    fade.target = hovered ? 1 : 0;
    if (restyle) fade.step = -1;
    this.apply(fade);
    if (fade.level !== fade.target && !this.running.includes(fade)) {
      fade.lastMs = performance.now();
      this.running.push(fade);
    }
  }

  tick(nowMs: number): void {
    for (let i = this.running.length - 1; i >= 0; i--) {
      const fade = this.running[i];
      const dt = nowMs - fade.lastMs;
      fade.lastMs = nowMs;
      fade.level = fade.target === 1 ? Math.min(1, fade.level + dt / ON_MS) : Math.max(0, fade.level - dt / OFF_MS);
      this.apply(fade);
      if (fade.level === fade.target) this.running.splice(i, 1);
    }
  }

  get active(): number {
    return this.running.length;
  }

  private apply(fade: Fade): void {
    const step = Math.round(fade.level * STEPS);
    if (step === fade.step) return;
    fade.step = step;
    if (fade.rise) {
      const scale = 1 + (RISE * step) / STEPS;
      fade.element.setProperties({ backgroundColor: fade.steps[step], transformScaleX: scale, transformScaleY: scale });
    } else {
      fade.element.setProperties({ backgroundColor: fade.steps[step] });
    }
  }
}

export const hoverFades = new HoverFades();

/** Moves running hover fades on; idle when none runs. */
export class HoverSystem extends createSystem({}) {
  update(): void {
    if (hoverFades.active > 0) hoverFades.tick(performance.now());
  }
}

function rgb(color: string): number[] {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex(channels: number[]): string {
  return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}
