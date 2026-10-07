/**
 * Timers pinned in space. The countdown text changes once a second (the frame loop compares integers and touches
 * the panel only when the second changes: no per-frame allocation). At zero the timer is marked done, its panel
 * flashes, and a short chime plays, panned toward where the timer is pinned so you can tell which one rang.
 */
import { createSystem, Quaternion, Vector3, type UIKit, type UIKitDocument } from '@iwsdk/core';
import { panelText, TIMER_SIZE, type Timer, type Workspace } from './model.js';
import { PinnedPanel } from './pinned.js';
import { workspace } from './store.js';

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
  buttonHover: '#9cc3ff',
} as const;

type Element = UIKit.Text;

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
    slots.label.setProperties({ text: panelText(paused ? `${t.label} - paused` : t.label) });
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
    const on = (id: string, handler: () => void) => {
      const element = get(id);
      const listener = (event: { stopPropagation?: () => void }) => {
        event.stopPropagation?.();
        unlockAudio();
        handler();
      };
      // Hover painted by hand: a UIKitML :hover style sticks on restyled elements (see boards.ts).
      const enter = () => element.setProperties({ borderColor: COLOR.buttonHover });
      const leave = () => element.setProperties({ borderColor: COLOR.button });
      element.addEventListener('click', listener);
      element.addEventListener('pointerenter', enter);
      element.addEventListener('pointerleave', leave);
      this.cleanups.push(() => {
        element.removeEventListener('click', listener);
        element.removeEventListener('pointerenter', enter);
        element.removeEventListener('pointerleave', leave);
      });
    };
    on('toggle', () => {
      const t = this.timer;
      if (t.state === 'running') workspace.dispatch({ op: 'pause_timer', timer: t.id });
      else if (t.state === 'paused') workspace.dispatch({ op: 'resume_timer', timer: t.id });
      else workspace.dispatch({ op: 'add_time', timer: t.id, minutes: Math.min(180, t.durationMs / 60_000) }, { label: 'restart timer' });
    });
    on('add', () => workspace.dispatch({ op: 'add_time', timer: this.timer.id, minutes: SNOOZE_MINUTES }));
    on('dismiss', () => workspace.dispatch({ op: 'dismiss_timer', timer: this.timer.id }, { notice: 'Timer closed.' }));
    return { box: get('timer'), label: get('label'), time: get('time'), toggle: get('toggle-label') };
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
  private readonly head = new Vector3();
  private readonly headRotation = new Quaternion();
  private readonly toTimer = new Vector3();
  private readonly right = new Vector3();

  init(): void {
    this.cleanupFuncs.push(workspace.subscribe(({ state, previous }) => this.sync(state, previous)));
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
  }

  private ring(view: TimerView, timer: Timer): void {
    view.flashUntil = Date.now() + FLASH_MS;
    workspace.notify({ text: `Time is up: ${panelText(timer.label)}`, error: false });
    const w = window as unknown as { __timerAlerts?: number };
    w.__timerAlerts = (w.__timerAlerts ?? 0) + 1; // observed by the Playwright tests
    // Pan toward the timer: +1 when it is to the user's right.
    this.world.camera.getWorldPosition(this.head);
    this.world.camera.getWorldQuaternion(this.headRotation);
    this.toTimer.set(timer.pose.x, timer.pose.y, timer.pose.z).sub(this.head).normalize();
    this.right.set(1, 0, 0).applyQuaternion(this.headRotation);
    chime(Math.max(-1, Math.min(1, this.toTimer.dot(this.right))));
  }
}

// A soft three-note chime, synthesised (no audio files to load). The AudioContext starts on the first gesture.
let audio: AudioContext | null = null;

function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null; // no Web Audio: the visual flash still tells the user
  }
}

function chime(pan: number): void {
  if (!audio) return;
  const ctx = audio;
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  panner.connect(ctx.destination);
  const start = ctx.currentTime + 0.02;
  for (let round = 0; round < 2; round++) {
    [659.25, 783.99, 1046.5].forEach((frequency, i) => {
      const at = start + round * 1.2 + i * 0.2;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
      osc.connect(gain).connect(panner);
      osc.start(at);
      osc.stop(at + 0.65);
    });
  }
}
