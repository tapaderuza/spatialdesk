/**
 * The one workspace in this browser: state, undo, and persistence. Every change goes through the Kotlin engine
 * (vendor/spatialdesk-shared), so the user's hands and the AI agent are validated by the same rules, and a batch
 * either applies whole or not at all. Local-first: IndexedDB is the source of truth, the server is never waited on.
 * Nothing here runs per frame; listeners are told once per change.
 */
import { Workspaces } from 'spatialdesk-shared';
import type { ApplyResult, Op, Pose, Workspace } from './model.js';

const engine = Workspaces.getInstance(); // Kotlin `object` exported as a singleton

export type ChangeSource = 'load' | 'user' | 'undo' | 'system';

export interface Change {
  state: Workspace;
  previous: Workspace | null;
  created: string[];
  source: ChangeSource;
}

export interface Notice {
  text: string;
  error: boolean;
}

export interface DispatchOptions {
  /** False for bookkeeping the user did not do themselves (a timer reaching zero): not worth an undo step. */
  undoable?: boolean;
  /** The user's eye pose, for arrange_space. */
  viewer?: Pose;
  /** What the undo button will say it undoes. */
  label?: string;
  /** Shown on the command panel when the change applies. */
  notice?: string;
  /** An AI plan: recorded with each step's reason, so it can be explained and undone step by step. */
  agent?: { intent: string; summary: string; source: string; steps: { label: string; why: string }[] };
}

export type DispatchResult = { ok: true; created: string[] } | { ok: false; error: string; opIndex?: number };

/** An applied AI plan, as the "what the AI did" view shows it. */
export interface AgentAction {
  id: number;
  atMs: number;
  intent: string;
  summary: string;
  source: string;
  steps: { label: string; why: string; undone: boolean }[];
}

/**
 * One applied change. The journal keeps every change since load with the state after it, so undo can reach back
 * past later changes: undoing one step of an earlier AI plan replays everything after it, in order, with the
 * original clock and viewer; whatever no longer applies (it depended on the undone step) is dropped and named.
 */
interface Entry {
  id: number;
  ops: Op[];
  nowMs: number;
  viewer: string | null;
  label: string;
  kind: 'user' | 'system' | 'agent';
  after: string;
  agent?: Omit<AgentAction, 'id' | 'atMs'>;
}

const JOURNAL_DEPTH = 60;
const SAVE_DELAY_MS = 400;

/**
 * `?fast`, for judges and demos: timers run in seconds instead of minutes (Focus 25 lasts 25 seconds, never under the
 * engine's 6-second minimum), so what the agent does when a block ends can be seen in a short session.
 */
export const TIMER_SCALE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fast') ? 1 / 60 : 1;
const MIN_TIMER_MINUTES = 0.1;

function fastTimers(ops: Op[]): Op[] {
  if (TIMER_SCALE === 1) return ops;
  return ops.map((op) =>
    op.op === 'start_timer' || op.op === 'add_time' ? { ...op, minutes: Math.max(MIN_TIMER_MINUTES, op.minutes * TIMER_SCALE) } : op,
  );
}

export class WorkspaceStore {
  private json = engine.empty();
  state: Workspace = JSON.parse(this.json) as Workspace;
  /** The scale every panel is drawn at for the workspace's view (Layout.kt): 1 on a Quest, smaller on narrower views. */
  panelScale = 1;
  private scaledView = '';
  /** State before journal[0]; journal[i].after is the state after entry i. */
  private base = this.json;
  private readonly journal: Entry[] = [];
  private nextEntryId = 1;
  private readonly listeners = new Set<(change: Change) => void>();
  private readonly noticeListeners = new Set<(notice: Notice) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Loads the saved workspace, or seeds the first-run one. Never throws: storage trouble means a fresh start. */
  async load(): Promise<void> {
    addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.flush());

    const saved = await readSaved();
    const valid = saved == null ? null : engine.load(saved);
    if (valid != null) {
      this.replace(valid, 'load', []);
      this.base = this.json;
      return;
    }
    const seeded = JSON.parse(engine.apply(this.json, JSON.stringify(STARTER), Date.now(), null)) as ApplyResult;
    if (seeded.ok && seeded.state) this.replace(JSON.stringify(seeded.state), 'load', seeded.created);
    this.base = this.json;
    this.scheduleSave();
  }

  dispatch(ops: Op | Op[], options: DispatchOptions = {}): DispatchResult {
    const list = fastTimers(Array.isArray(ops) ? ops : [ops]);
    const viewer = options.viewer ? JSON.stringify(options.viewer) : null;
    const result = JSON.parse(engine.apply(this.json, JSON.stringify(list), Date.now(), viewer)) as ApplyResult;
    if (!result.ok || !result.state) {
      const error = result.error ?? 'That did not work.';
      this.notify({ text: error, error: true });
      return { ok: false, error, opIndex: result.opIndex };
    }
    const after = JSON.stringify(result.state);
    const kind = options.agent ? 'agent' : options.undoable === false ? 'system' : 'user';
    this.journal.push({
      id: this.nextEntryId++,
      ops: list,
      nowMs: Date.now(),
      viewer,
      label: options.label ?? describe(list[0]),
      kind,
      after,
      agent: options.agent && { ...options.agent, steps: options.agent.steps.map((s) => ({ ...s, undone: false })) },
    });
    if (this.journal.length > JOURNAL_DEPTH) this.base = this.journal.shift()!.after;
    this.replace(after, kind === 'system' ? 'system' : 'user', result.created);
    if (options.notice) this.notify({ text: options.notice, error: false });
    this.scheduleSave();
    return { ok: true, created: result.created };
  }

  get canUndo(): boolean {
    return this.lastUndoable() >= 0;
  }

  /** What the next undo would revert, for the button label. */
  get undoLabel(): string | null {
    return this.journal[this.lastUndoable()]?.label ?? null;
  }

  /** Undoes the latest change the user (or the AI on their behalf) made; timers ringing are not undo steps. */
  undo(): boolean {
    const i = this.lastUndoable();
    if (i < 0) return false;
    const label = this.journal[i].label;
    this.rebuild(i, () => null, `Undone: ${label}`);
    return true;
  }

  /** Applied AI plans, newest first. */
  agentActions(): AgentAction[] {
    return this.journal
      .filter((e) => e.agent)
      .map((e) => ({ id: e.id, atMs: e.nowMs, ...e.agent! }))
      .reverse();
  }

  /** Undoes a whole AI plan, even after later changes (they are replayed on top). */
  undoAction(id: number): boolean {
    const i = this.journal.findIndex((e) => e.id === id);
    if (i < 0) return false;
    this.rebuild(i, () => null, `Undone: ${this.journal[i].agent?.summary ?? this.journal[i].label}`);
    return true;
  }

  /** Undoes one step of an AI plan; steps that depended on it go too, and the notice says which. */
  undoAgentStep(id: number, step: number): boolean {
    const i = this.journal.findIndex((e) => e.id === id);
    const entry = this.journal[i];
    if (!entry?.agent || !entry.agent.steps[step] || entry.agent.steps[step].undone) return false;
    const steps = entry.agent.steps.map((s, k) => ({ ...s, undone: s.undone || k === step }));
    this.rebuild(i, () => ({ ...entry, agent: { ...entry.agent!, steps } }), `Undone: ${entry.agent.steps[step].label}`);
    return true;
  }

  private lastUndoable(): number {
    for (let i = this.journal.length - 1; i >= 0; i--) if (this.journal[i].kind !== 'system') return i;
    return -1;
  }

  /**
   * Replaces journal[i] (or removes it when [change] returns null), then replays every later entry from the state
   * before it, with each entry's own clock and viewer. AI plans replay step by step, so a step that no longer applies
   * is marked undone while the rest stays; any other entry that no longer applies is dropped. Both are reported.
   */
  private rebuild(i: number, change: (entry: Entry) => Entry | null, notice: string): void {
    let state = i === 0 ? this.base : this.journal[i - 1].after;
    const dropped: string[] = [];
    const replaced = change(this.journal[i]);
    const tail = [...(replaced ? [replaced] : []), ...this.journal.slice(i + 1)];
    const kept: Entry[] = [];
    for (const entry of tail) {
      if (entry.agent) {
        const steps = entry.agent.steps.map((s) => ({ ...s }));
        entry.ops.forEach((op, k) => {
          if (steps[k].undone) return;
          const result = JSON.parse(engine.apply(state, JSON.stringify([op]), entry.nowMs, entry.viewer)) as ApplyResult;
          if (result.ok && result.state) {
            state = JSON.stringify(result.state);
          } else {
            steps[k].undone = true;
            dropped.push(steps[k].label);
          }
        });
        if (steps.some((s) => !s.undone)) kept.push({ ...entry, agent: { ...entry.agent, steps }, after: state });
        continue;
      }
      const result = JSON.parse(engine.apply(state, JSON.stringify(entry.ops), entry.nowMs, entry.viewer)) as ApplyResult;
      if (result.ok && result.state) {
        state = JSON.stringify(result.state);
        kept.push({ ...entry, after: state });
      } else if (entry.kind !== 'system') {
        dropped.push(entry.label);
      }
    }
    this.journal.splice(i, this.journal.length - i, ...kept);
    this.replace(state, 'undo', []);
    this.notify({ text: dropped.length ? `${notice}. Also undone, as it depended on it: ${dropped.join(', ')}.` : notice, error: false });
    this.scheduleSave();
  }

  subscribe(listener: (change: Change) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onNotice(listener: (notice: Notice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  notify(notice: Notice): void {
    for (const listener of this.noticeListeners) listener(notice);
  }

  /** Writes now (page hidden or closing); otherwise saves are debounced. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void writeSaved(this.json);
  }

  private replace(json: string, source: ChangeSource, created: string[]): void {
    const previous = this.state;
    this.json = json;
    this.state = JSON.parse(json) as Workspace;
    const view = this.state.view ? `${this.state.view.halfWidthDeg},${this.state.view.upDeg},${this.state.view.downDeg}` : '';
    if (view !== this.scaledView) {
      this.scaledView = view;
      this.panelScale = engine.panelScale(json);
    }
    const change: Change = { state: this.state, previous: source === 'load' ? null : previous, created, source };
    for (const listener of this.listeners) listener(change);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }
}

/** Short labels for the undo button ("Undo move card"). */
function describe(op: Op | undefined): string {
  switch (op?.op) {
    case 'create_board': return 'new board';
    case 'add_card': return 'new card';
    case 'update_card': return 'edit card';
    case 'move_card': return 'move card';
    case 'remove_card': return 'remove card';
    case 'clear_done': return 'clear done';
    case 'delete_board': return 'delete board';
    case 'focus_board': return 'switch board';
    case 'start_timer': return 'start timer';
    case 'pause_timer': return 'pause timer';
    case 'resume_timer': return 'resume timer';
    case 'add_time': return 'add time';
    case 'dismiss_timer': return 'dismiss timer';
    case 'arrange_space': return 'arrange space';
    case 'set_pose': return 'move';
    case 'set_view': return 'fit to view';
    default: return 'last change';
  }
}

/** First run: a board that teaches the interactions by being used, and a second one parked to the side. */
const STARTER: Op[] = [
  {
    op: 'create_board',
    title: 'Getting started',
    cards: [
      { title: 'Tap a card to pick it up' },
      { title: 'Tap a column to drop it there' },
      { title: 'Grab the bar under a board to move it' },
      { title: 'Press Focus 25 to pin a timer', column: 'Doing' },
      { title: 'Lost? Bring everything to me', column: 'Doing' },
      { title: 'Every action can be undone', column: 'Done' },
    ],
  },
  {
    op: 'create_board',
    title: 'Ideas',
    columns: ['Someday', 'Next', 'Done'],
    cards: [
      { title: 'Plan my day with the AI agent', column: 'Next', priority: 'high' },
      { title: 'Try Focus mode for deep work' },
    ],
  },
];

// IndexedDB, one record. Any failure (private mode, quota, blocked) degrades to an in-memory workspace.
const DB_NAME = 'spatialdesk';
const STORE_NAME = 'workspace';
const KEY = 'current';
let dbPromise: Promise<IDBDatabase> | null = null;

const OPEN_TIMEOUT_MS = 2000;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    // An open can stall (blocked by another tab's upgrade, a stuck storage layer): start fresh rather than wait.
    const timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), OPEN_TIMEOUT_MS);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
    request.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('IndexedDB open blocked'));
    };
  });
  return dbPromise;
}

async function readSaved(): Promise<string | null> {
  try {
    const database = await db();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(KEY);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('[workspace] storage unavailable, starting fresh', error);
    return null;
  }
}

async function writeSaved(json: string): Promise<void> {
  try {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(json, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn('[workspace] could not save', error);
  }
}

export const workspace = new WorkspaceStore();
(window as unknown as { __workspace: WorkspaceStore }).__workspace = workspace; // driven by the Playwright tests
