/**
 * The headset's side of "a family member or carer follows along from a phone or a computer" (companion.html).
 *
 *   invite()  -> a short code, good for two minutes; the person types it on their own screen
 *   asking    -> someone asked to see the Today board; nothing is shared until the owner presses Allow
 *   sharing   -> the Today board's card titles are sent (and re-sent when they change); the helper can call for help
 *   a call    -> the guided setup opens in the headset, with its orb; the owner can skip any step of it
 *
 * Plain state and a poll every couple of seconds, no framework, so it runs the same in the headset, in a flat browser and
 * in a test. Only what the owner allowed leaves: card titles and their column, never notes, timers or the comfort profile.
 * Stopping, the room's 15 minutes and a lost session all end it, and the helper then sees that it has ended.
 */
import type { AssistApi, HelpState, SharedTask } from './api.js';
import { AssistError } from './api.js';

export type PairingStage = 'idle' | 'inviting' | 'asking' | 'sharing' | 'ended';
export type EndReason = 'stopped' | 'time' | 'invite' | 'offline' | 'network' | 'limit' | null;

export interface PairingView {
  stage: PairingStage;
  /** The code to type, grouped as shown ("K7M2 9PQX"). */
  code: string;
  /** Helpers waiting for the owner's answer, and helpers whose view is on. */
  pending: number;
  helpers: number;
  /** Cards sent to the helper by the last update. */
  shared: number;
  reason: EndReason;
  /** False while the server cannot be reached (the polling carries on). */
  online: boolean;
  /** Calls for help received, and what became of the latest. */
  helpCalls: number;
  lastHelp: HelpState | null;
  /** Milliseconds left of the code and of the room, from this device's own clock (see [INVITE_MS]). */
  inviteLeftMs: number;
  roomLeftMs: number;
}

export interface PairingDeps {
  api: AssistApi;
  /** The headset's own session with the command server; null while offline. */
  session(): string | null;
  /** The cards of the Today board, as they are now. */
  tasks(): SharedTask[];
  /** Opens the guided setup; false when nothing can open it. */
  openSetup(): boolean;
  /** Told when that setup ends (skipped or finished). */
  onSetupClosed(listener: (skipped: boolean) => void): () => void;
  /** Milliseconds, monotonic (performance.now). */
  now?(): number;
  pollMs?: number;
}

/** What the server grants by default (AssistLimits): a code lasts two minutes and a room fifteen. */
export const INVITE_MS = 120_000;
export const ROOM_MS = 900_000;
const SLOW_POLL_MS = 5_000;

export class Pairing {
  readonly view: PairingView = { stage: 'idle', code: '', pending: 0, helpers: 0, shared: 0, reason: null, online: true, helpCalls: 0, lastHelp: null, inviteLeftMs: 0, roomLeftMs: 0 };
  private pairId: string | null = null;
  private createdAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private busy = false;
  private pendingIds: string[] = [];
  private readonly pushed = new Map<string, string>();
  private readonly handled = new Set<string>();
  private activeHelp: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly stopListening: () => void;

  constructor(private readonly deps: PairingDeps) {
    this.stopListening = deps.onSetupClosed((skipped) => void this.setupClosed(skipped));
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A new code. A code still open is withdrawn first: one invitation at a time. */
  async invite(): Promise<void> {
    if (this.pairId) await this.close('stopped', false);
    const session = this.deps.session();
    if (!session) return this.end('offline');
    try {
      const pair = await this.deps.api.createPair(session);
      this.pairId = pair.pairId;
      this.createdAt = this.now();
      this.pushed.clear();
      this.handled.clear();
      this.activeHelp = null;
      this.pendingIds = [];
      this.failures = 0;
      Object.assign(this.view, { stage: 'inviting', code: group(pair.code), pending: 0, helpers: 0, shared: 0, reason: null, online: true, helpCalls: 0, lastHelp: null });
      this.tick();
      this.emit();
      this.schedule();
    } catch (error) {
      this.end(reasonOf(error));
    }
  }

  /** "Allow": every helper waiting sees the Today board, and only that. */
  async allow(): Promise<void> {
    const session = this.deps.session();
    if (!this.pairId || !session) return;
    const tasks = this.deps.tasks();
    for (const requestId of this.pendingIds) {
      try {
        await this.deps.api.approve(session, this.pairId, requestId, false, tasks);
        this.pushed.set(requestId, JSON.stringify(tasks));
      } catch (error) {
        if (error instanceof AssistError && error.status !== 0) return this.end(reasonOf(error));
      }
    }
    await this.poll();
  }

  /** "No" or "Stop sharing": the code and the helper's view stop working at once. */
  async stop(): Promise<void> {
    await this.close('stopped', true);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopListening();
    this.listeners.clear();
  }

  /** One round with the server: who is waiting, who is watching, what is new. Public so tests can drive it without waiting. */
  async poll(): Promise<void> {
    const pairId = this.pairId;
    const session = this.deps.session();
    if (!pairId || this.busy) return;
    if (!session) return this.end('offline');
    this.busy = true;
    try {
      const owner = await this.deps.api.owner(session, pairId);
      this.failures = 0;
      this.view.online = true;
      const waiting = owner.requests.filter((request) => request.state === 'pending');
      const watching = owner.requests.filter((request) => request.state === 'approved');
      this.pendingIds = waiting.map((request) => request.requestId);
      this.view.pending = waiting.length;
      this.view.helpers = watching.length;
      this.tick();
      if (waiting.length === 0 && watching.length === 0 && this.view.inviteLeftMs <= 0) {
        this.busy = false;
        await this.close('invite', true);
        return;
      }
      this.view.stage = waiting.length ? 'asking' : watching.length ? 'sharing' : 'inviting';
      if (watching.length) await this.share(session, pairId, watching.map((request) => request.requestId));
      // A server from before the help calls has no such list: that is no calls, not an error.
      for (const help of owner.help ?? []) {
        if (help.state === 'pending' && !this.handled.has(help.helpId)) await this.answer(session, pairId, help.helpId);
      }
      this.emit();
    } catch (error) {
      if (error instanceof AssistError && error.status === 0) {
        this.failures++;
        this.view.online = false;
        this.emit();
      } else {
        this.end(reasonOf(error, 'time')); // the room is gone: it ran out, or the owner's session did
      }
    } finally {
      this.busy = false;
    }
  }

  /** Sends the Today board to each helper whose copy is out of date. */
  private async share(session: string, pairId: string, requestIds: string[]): Promise<void> {
    const tasks = this.deps.tasks();
    const key = JSON.stringify(tasks);
    this.view.shared = tasks.length;
    for (const requestId of requestIds) {
      if (this.pushed.get(requestId) === key) continue;
      try {
        await this.deps.api.approve(session, pairId, requestId, false, tasks);
        this.pushed.set(requestId, key);
      } catch (error) {
        if (error instanceof AssistError && error.status !== 0) throw error; // refused: the room is not what it was
      }
    }
  }

  /** A call for help: the guided setup opens (the owner may skip any step), and the helper is told it has. */
  private async answer(session: string, pairId: string, helpId: string): Promise<void> {
    this.handled.add(helpId);
    this.view.helpCalls++;
    const opened = this.deps.openSetup();
    this.activeHelp = opened ? helpId : null;
    this.view.lastHelp = opened ? 'shown' : 'dismissed';
    await this.report(session, pairId, helpId, this.view.lastHelp);
  }

  private async setupClosed(skipped: boolean): Promise<void> {
    const helpId = this.activeHelp;
    const session = this.deps.session();
    if (!helpId || !this.pairId || !session) return;
    this.activeHelp = null;
    this.view.lastHelp = skipped ? 'dismissed' : 'done';
    this.emit();
    await this.report(session, this.pairId, helpId, this.view.lastHelp);
  }

  private async report(session: string, pairId: string, helpId: string, state: Exclude<HelpState, 'pending'>): Promise<void> {
    try {
      await this.deps.api.resolveHelp(session, pairId, helpId, state);
    } catch {
      /* the helper's screen shows "sent" a little longer; the headset has already done its part */
    }
  }

  private async close(reason: EndReason, revoke: boolean): Promise<void> {
    const pairId = this.pairId;
    const session = this.deps.session();
    this.pairId = null;
    if (revoke && pairId && session) {
      try {
        await this.deps.api.revoke(session, pairId);
      } catch {
        /* it expires by itself within fifteen minutes */
      }
    }
    this.end(reason);
  }

  private end(reason: EndReason): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pairId = null;
    Object.assign(this.view, { stage: 'ended', reason, pending: 0, helpers: 0, code: '', online: reason !== 'network' && reason !== 'offline' });
    this.emit();
  }

  private tick(): void {
    const elapsed = this.now() - this.createdAt;
    this.view.inviteLeftMs = Math.max(0, INVITE_MS - elapsed);
    this.view.roomLeftMs = Math.max(0, ROOM_MS - elapsed);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const base = this.deps.pollMs ?? 2_000;
    this.timer = setTimeout(async () => {
      await this.poll();
      if (this.pairId) this.schedule();
    }, this.failures > 3 ? Math.max(base, SLOW_POLL_MS) : base);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** "K7M29PQX" -> "K7M2 9PQX": easier to read out and to type. */
function group(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

function reasonOf(error: unknown, fallback: EndReason = 'network'): EndReason {
  if (!(error instanceof AssistError)) return 'network';
  if (error.status === 0) return 'network';
  if (error.code === 'session_expired') return 'offline';
  if (error.code === 'pair_limit') return 'limit';
  return fallback;
}
