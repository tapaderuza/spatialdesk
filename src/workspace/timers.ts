/**
 * Timers pinned in space. The countdown text changes once a second (the frame loop compares integers and touches
 * the panel only when the second changes: no per-frame allocation). At zero the timer is marked done, its panel
 * flashes, and a short chime plays from where the timer is pinned (src/ui/sounds.ts), so you can tell which one rang.
 * While a focus block runs (any running timer but a break), the quiet focus ambience plays.
 */
import { createSystem, type UIKit, type UIKitDocument } from '@iwsdk/core';
import { onAccessPreferences } from '../accessibility/preferences.js';
import { presentationText, timerPresentationLabel } from '../accessibility/presentation.js';
import { hoverFades } from '../ui/hover.js';
import { PanelHits } from '../ui/panel-hits.js';
import { idleBorder } from '../ui/settings.js';
import { alarm, setAmbience, unlockAudio } from '../ui/sounds.js';
import { panelText, TIMER_SIZE, type Timer, type Workspace } from './model.js';
import { PinnedPanel } from './pinned.js';
import { TIMER_SCALE, workspace } from './store.js';

const CONFIG = `${import.meta.env.BASE_URL}ui/timer.uikitml`;
const HANDLE_WIDTH = 0.14;
const FLASH_MS = 6000;
const FLASH_PERIOD_MS = 500;
const SNOOZE_MINUTES = 5;
const COLOR = {
  panel: '#15181e',
  border: '#2c333d',
  flash: '#5c2a24',
  done: '#241b1a',
  doneBorder: '#ff8a7a',
  running: '#5ee0a0',
  button: '#2a313b',
} as const;

type Element = UIKit.Text;

/** Told when a running timer reaches zero (the agent suggests what comes next). */
export const timerFinishedListeners = new Set<(timer: Timer) => void>();

class TimerView {
  readonly pinned: PinnedPanel;
  readonly cleanups: (() => void)[] = [];
  timer: Timer;
  private slots: { box: Element; label: Element; time: Element; toggle: Element } | null = null;
  private shownSeconds = -1;
  private finishing = false;
  flashUntil = 0;
  private flashOn = false;

  constructor(
    readonly system: TimerSystem,
    timer: Timer,
  ) {
    this.timer = timer;
    this.pinned = new PinnedPanel(system.world, timer.id, CONFIG, TIMER_SIZE, HANDLE_WIDTH);
    this.pinned.whenReady((document) => {
      this.slots = this.bind(document);
      this.render();
    });
  }

  update(timer: Timer): void {
    if (timer.state !== 'running') this.finishing = false;
    this.timer = timer;
    this.shownSeconds = -1;
    this.render();
  }

  render(): void {
    const slots = this.slots;
    if (!slots) return;
    const t = this.timer;
    const paused = t.state === 'paused';
    slots.label.setProperties({ text: panelText(timerPresentationLabel(t)) });
    slots.toggle.setProperties({ text: t.state === 'running' ? 'Pause' : paused ? 'Resume' : 'Again' });
    slots.box.setProperties({
      backgroundColor: t.state === 'done' ? COLOR.done : COLOR.panel,
      borderColor: t.state === 'done' ? COLOR.doneBorder : t.state === 'running' ? COLOR.running : COLOR.border,
    });
    this.tick(Date.now());
  }

  /** Per frame: integer compare; the panel is written once a second, or on a flash toggle. */
  tick(now: number): void {
    const slots = this.slots;
    const t = this.timer;
    if (!slots) return;
    const remaining = t.state === 'running' ? (t.endsAtMs ?? now) - now : t.remainingMs;
    const seconds = t.state === 'done' ? 0 : Math.max(0, Math.ceil(remaining / 1000));
    if (seconds !== this.shownSeconds) {
      this.shownSeconds = seconds;
      slots.time.setProperties({ text: t.state === 'done' ? 'Done' : clock(seconds) });
    }
    if (t.state === 'running' && remaining <= 0 && !this.finishing) {
      this.finishing = true;
      workspace.dispatch({ op: 'finish_timer', timer: t.id }, { undoable: false });
    }
    if (this.flashUntil > 0) {
      const on = now < this.flashUntil && Math.floor((this.flashUntil - now) / FLASH_PERIOD_MS) % 2 === 0;
      if (on !== this.flashOn) {
        this.flashOn = on;
        slots.box.setProperties({ backgroundColor: on ? COLOR.flash : COLOR.done });
      }
      if (now >= this.flashUntil) this.flashUntil = 0;
    }
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.pinned.dispose();
  }

  private bind(document: UIKitDocument) {
    const get = (id: string) => {
      const element = document.querySelector(`#${id}`) as Element | null;
      if (!element) throw new Error(`timer.uikitml has no #${id}`);
      element.name = `${this.timer.id}:${id}`;
      return element;
    };
    const box = get('timer');
    const buttons = [['toggle', get('toggle')], ['add', get('add')], ['dismiss', get('dismiss')]] as const;
    // One listener on the panel root (see PanelHits); hover painted by hand (a UIKitML :hover style sticks).
    new PanelHits(box, buttons, {
      click: (key) => {
        unlockAudio();
        const t = this.timer;
        if (key === 'add') workspace.dispatch({ op: 'add_time', timer: t.id, minutes: SNOOZE_MINUTES });
        else if (key === 'dismiss') workspace.dispatch({ op: 'dismiss_timer', timer: t.id }, { notice: 'Timer closed.' });
        else if (t.state === 'running') workspace.dispatch({ op: 'pause_timer', timer: t.id });
        else if (t.state === 'paused') workspace.dispatch({ op: 'resume_timer', timer: t.id });
        else workspace.dispatch({ op: 'add_time', timer: t.id, minutes: Math.min(180, t.durationMs / 60_000 / TIMER_SCALE) }, { label: 'restart timer' });
      },
      hover: (key, hovered) => {
        const button = buttons.find(([k]) => k === key)?.[1];
        if (!button) return;
        button.setProperties({ borderColor: idleBorder(COLOR.button) });
        hoverFades.paint(button, COLOR.button, hovered); // src/ui/hover.ts
      },
    }, this.cleanups);
    return { box, label: get('label'), time: get('time'), toggle: get('toggle-label') };
  }
}

function clock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export class TimerSystem extends createSystem({}) {
  private readonly views = new Map<string, TimerView>();

  init(): void {
    this.cleanupFuncs.push(workspace.subscribe(({ state, previous }) => this.sync(state, previous)));
    this.cleanupFuncs.push(onAccessPreferences(() => {
      for (const view of this.views.values()) view.render();
    }));
    this.sync(workspace.state, null);
    addEventListener('pointerdown', unlockAudio, { passive: true });
    addEventListener('keydown', unlockAudio);
    this.cleanupFuncs.push(() => {
      removeEventListener('pointerdown', unlockAudio);
      removeEventListener('keydown', unlockAudio);
      for (const view of this.views.values()) view.dispose();
      this.views.clear();
    });
  }

  update(): void {
    if (this.views.size === 0) return;
    const now = Date.now();
    for (const view of this.views.values()) view.tick(now);
  }

  private sync(state: Workspace, previous: Workspace | null): void {
    const ids = new Set(state.timers.map((t) => t.id));
    for (const [id, view] of this.views) {
      if (!ids.has(id)) {
        view.dispose();
        this.views.delete(id);
      }
    }
    for (const timer of state.timers) {
      let view = this.views.get(timer.id);
      if (!view) {
        view = new TimerView(this, timer);
        this.views.set(timer.id, view);
      } else {
        view.update(timer);
      }
      view.pinned.place(timer.pose);
      const before = previous?.timers.find((t) => t.id === timer.id);
      if (before?.state === 'running' && timer.state === 'done') this.ring(view, timer);
    }
    setAmbience(state.timers.some((t) => t.state === 'running' && !/^break$/i.test(t.label.trim())));
  }

  private ring(view: TimerView, timer: Timer): void {
    view.flashUntil = Date.now() + FLASH_MS;
    workspace.notify({ text: `Time is up: ${panelText(presentationText(timer.label))}`, error: false });
    const w = window as unknown as { __timerAlerts?: number };
    w.__timerAlerts = (w.__timerAlerts ?? 0) + 1; // observed by the Playwright tests
    alarm(timer.pose);
    for (const listener of timerFinishedListeners) listener(timer);
  }
}
