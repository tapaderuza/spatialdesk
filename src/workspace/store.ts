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
}

export type DispatchResult = { ok: true; created: string[] } | { ok: false; error: string; opIndex?: number };

const UNDO_DEPTH = 50;
const SAVE_DELAY_MS = 400;

export class WorkspaceStore {
  private json = engine.empty();
  state: Workspace = JSON.parse(this.json) as Workspace;
  private readonly undoStack: { json: string; label: string }[] = [];
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
      return;
    }
    const seeded = JSON.parse(engine.apply(this.json, JSON.stringify(STARTER), Date.now(), null)) as ApplyResult;
    if (seeded.ok && seeded.state) this.replace(JSON.stringify(seeded.state), 'load', seeded.created);
    this.scheduleSave();
  }

  dispatch(ops: Op | Op[], options: DispatchOptions = {}): DispatchResult {
    const list = Array.isArray(ops) ? ops : [ops];
    const viewer = options.viewer ? JSON.stringify(options.viewer) : null;
    const result = JSON.parse(engine.apply(this.json, JSON.stringify(list), Date.now(), viewer)) as ApplyResult;
    if (!result.ok || !result.state) {
      const error = result.error ?? 'That did not work.';
      this.notify({ text: error, error: true });
      return { ok: false, error, opIndex: result.opIndex };
    }
    if (options.undoable !== false) {
      this.undoStack.push({ json: this.json, label: options.label ?? describe(list[0]) });
      if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    }
    this.replace(JSON.stringify(result.state), options.undoable === false ? 'system' : 'user', result.created);
    if (options.notice) this.notify({ text: options.notice, error: false });
    this.scheduleSave();
    return { ok: true, created: result.created };
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** What the next undo would revert, for the button label. */
  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  undo(): boolean {
    const step = this.undoStack.pop();
    if (!step) return false;
    this.replace(step.json, 'undo', []);
    this.notify({ text: `Undone: ${step.label}`, error: false });
    this.scheduleSave();
    return true;
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
