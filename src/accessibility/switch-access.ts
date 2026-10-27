import { accessPreferences, onAccessPreferences } from './preferences.js';

export interface SwitchControl {
  key: string;
  label: string;
  activate: () => void;
}

export interface SwitchHighlight { key: string; label: string }

export interface SwitchAccessOptions {
  onHighlight?: (control: Readonly<SwitchHighlight> | null) => void;
  onSelect?: (control: Readonly<SwitchHighlight>) => void;
  onEscape?: () => void;
  /** Injectable for a paired screen or tests. The browser document is the default. */
  eventTarget?: EventTarget;
  /** Optional fixed interval; otherwise follows the validated access preference. */
  intervalMs?: number;
}

export interface SwitchSnapshot {
  running: boolean;
  disposed: boolean;
  surfaceId: string;
  controlCount: number;
  generation: number;
  armed: boolean;
  index: number;
  highlighted: SwitchHighlight | null;
}

/** One explicit press arms a newly shown surface; a later fresh press selects the highlighted option. */
export class SwitchAccess {
  private controls: readonly Readonly<SwitchControl>[] = [];
  private surfaceId = '';
  private generation = 0;
  private index = -1;
  private armed = false;
  private running = false;
  private disposed = false;
  private heldKey: 'select' | 'enter' | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly target: EventTarget | null;
  private readonly unsubscribe: () => void;
  private previousInterval: number;

  constructor(private readonly options: SwitchAccessOptions = {}) {
    if (options.intervalMs !== undefined && (!Number.isInteger(options.intervalMs) || options.intervalMs < 600 || options.intervalMs > 6000)) throw new RangeError('Scan interval must be 600 to 6000 milliseconds.');
    this.target = options.eventTarget ?? (typeof document === 'undefined' ? null : document);
    this.previousInterval = this.interval();
    this.unsubscribe = onAccessPreferences(() => {
      const interval = this.interval();
      if (interval !== this.previousInterval) { this.previousInterval = interval; this.schedule(); }
    });
  }

  /** Call on meaningful content changes, not on highlight painting: even a reused ID invalidates old selection. */
  setSurface(id: string, controls: readonly SwitchControl[]): void {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.controls = [];
    this.surfaceId = '';
    this.disarm();
    if (generation !== this.generation || this.disposed) return;
    if (typeof id !== 'string' || id.length > 200 || controls.length > 256 || (controls.length > 0 && !id.trim())) throw new RangeError('Invalid switch-access surface.');
    const keys = new Set<string>();
    for (const control of controls) {
      if (typeof control.key !== 'string' || !control.key.trim() || control.key.length > 150 || keys.has(control.key) || typeof control.label !== 'string' || !control.label.trim() || control.label.length > 500 || typeof control.activate !== 'function') throw new RangeError('Switch controls need unique keys, readable labels and an action.');
      keys.add(control.key);
    }
    this.surfaceId = id;
    this.controls = controls.map(control => Object.freeze({ key: control.key, label: control.label, activate: control.activate }));
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.target?.addEventListener('keydown', this.keyDown, true);
    this.target?.addEventListener('keyup', this.keyUp, true);
    this.disarm();
  }

  stop(): void {
    this.running = false;
    this.target?.removeEventListener('keydown', this.keyDown, true);
    this.target?.removeEventListener('keyup', this.keyUp, true);
    this.heldKey = null;
    this.disarm();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.stop(); }
    finally {
      this.unsubscribe();
      this.controls = [];
      this.surfaceId = '';
      this.generation++;
    }
  }

  /** Deliberate manual navigation; also used by the scan timer outside the render loop. */
  advance(): void {
    if (!this.running || this.disposed || this.controls.length === 0) return;
    const generation = this.generation;
    this.index = (this.index + 1) % this.controls.length;
    this.armed = true;
    this.options.onHighlight?.(this.highlight());
    if (generation === this.generation) this.schedule();
  }

  snapshot(): SwitchSnapshot {
    return { running: this.running, disposed: this.disposed, surfaceId: this.surfaceId, controlCount: this.controls.length, generation: this.generation, armed: this.armed, index: this.index, highlighted: this.highlight() };
  }

  private highlight(): SwitchHighlight | null {
    const control = this.armed ? this.controls[this.index] : null;
    return control ? { key: control.key, label: control.label } : null;
  }

  private interval(): number { return this.options.intervalMs ?? accessPreferences.scanIntervalMs; }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.running || this.disposed || !this.armed || this.controls.length < 2) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation === this.generation) this.advance();
    }, this.interval());
  }

  private disarm(): void {
    this.clearTimer();
    this.armed = false;
    this.index = -1;
    this.options.onHighlight?.(null);
  }

  private select(): void {
    const control = this.controls[this.index];
    if (!this.armed || !control) { this.advance(); return; }
    const generation = this.generation;
    // Disarm before an action can replace a panel. A held input can never operate the replacement.
    this.disarm();
    if (generation !== this.generation || !this.running || this.disposed) return;
    control.activate();
    this.options.onSelect?.({ key: control.key, label: control.label });
  }

  private readonly keyDown = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (!this.running || this.disposed || editableEvent(key) || key.ctrlKey || key.metaKey || key.altKey) return;
    if (key.key === 'Escape') {
      key.preventDefault();
      key.stopPropagation();
      this.stop();
      this.options.onEscape?.();
      return;
    }
    const select = selectionKey(key);
    if (select == null) return;
    key.preventDefault();
    key.stopPropagation();
    if (key.repeat || this.heldKey !== null || this.controls.length === 0) return;
    this.heldKey = select;
    this.select();
  };

  private readonly keyUp = (event: Event): void => {
    const key = event as KeyboardEvent;
    const select = selectionKey(key);
    if (select == null) return;
    if (select === this.heldKey) this.heldKey = null;
    if (!editableEvent(key)) { key.preventDefault(); key.stopPropagation(); }
  };
}

function selectionKey(event: KeyboardEvent): 'select' | 'enter' | null {
  if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') return 'select';
  return event.key === 'Enter' ? 'enter' : null;
}

/** Do not steal typing, passphrases, select controls or rich-text input, including within an open shadow root. */
function editableEvent(event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  for (const target of path) {
    const element = target as Element | null;
    if (typeof element?.closest === 'function' && element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return true;
    // Works for a non-DOM event target too, and avoids assuming the global Element exists in a paired renderer.
    const tag = (target as { tagName?: string } | null)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  }
  return false;
}
