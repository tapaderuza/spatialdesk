/**
 * What the user is looking at, for the agent: "move this to Done", said while the eyes rest on a card, means that card.
 *
 * A ray from the centre of the view (the eyes where the headset tracks them, else the head, as src/ui/gaze.ts does) is
 * tested against the panels five times a second, never per frame, where they were last drawn; while hands-free runs,
 * its own test of the same ray is reused instead. An item the gaze rests on for a second becomes the focus, and stays
 * it for ten seconds after the eyes move on: people glance at the agent's card while they speak.
 * Only what a panel says it stands for can be "this" (a card, a column, a board, a timer: PanelHandlers.refer); the
 * command panel and the agent's card neither set the focus nor clear it.
 *
 * The focus travels to the agent only with words that point ([pointsAtSomething]), and only as ids: the server marks
 * the item in its own copy of the workspace (server Planner.kt, Prompt.lookedAt), so nothing is ever shown to the user
 * and no text from the headset reaches the model's rules. Runs in XR only.
 */
import { createSystem, Vector3, VisibilityState } from '@iwsdk/core';
import { gazeFinding } from './gaze.js';
import { livePanels, type GazeTarget } from './panel-hits.js';
import type { Workspace } from '../workspace/model.js';

/** What a control stands for, by id, and its title (for "help me start this" and the tests). */
export interface Referent {
  board?: string;
  column?: string;
  card?: string;
  timer?: string;
  title: string;
}

/** What the agent is sent: ids only. */
export type Attention = Pick<Referent, 'board' | 'column' | 'card' | 'timer'>;

/** Five tests a second: a one-second dwell is measured to within 200 ms, at no cost worth a frame. */
const TEST_EVERY_MS = 200;
const DWELL_MS = 1000;
/** How long a focus is still "this" after the eyes have moved on. */
const KEEP_MS = 10_000;

interface Focus {
  referent: Referent;
  /** When the eyes were last on it. */
  seenAt: number;
}

let focus: Focus | null = null;

/** "this", "that", "it", "esto", "esta tarea", "ese": words that point instead of naming. Accents and case ignored. */
const POINTING = /\b(?:this|that|these|those|it|here|esto|esta|este|estas|estos|eso|esa|ese|esas|esos|aqui|ahi)\b/;

export function pointsAtSomething(text: string): boolean {
  return POINTING.test(fold(text));
}

/** A request that is nothing but a pointer ("this", "this task", "esta tarea"): it names no task of its own. */
export function onlyPoints(text: string): boolean {
  return /^(?:(?:this|that|it)(?: one| task| card)?|(?:esto|eso)|(?:esta|esa)(?: tarea| tarjeta)?|(?:este|ese)(?: paso)?)$/.test(fold(text).replace(/[^a-z ]+/g, ' ').trim());
}

function sameItem(a: Referent, b: Referent): boolean {
  return a.card === b.card && a.column === b.column && a.board === b.board && a.timer === b.timer;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** What the eyes rested on lately, if it is still in [workspace] (a card may have been removed since): else null. */
export function lookedAt(workspace: Workspace, now = performance.now()): Referent | null {
  if (!focus || now - focus.seenAt > KEEP_MS) return null;
  const r = focus.referent;
  const exists = r.card
    ? workspace.boards.some((b) => b.columns.some((c) => c.cards.some((k) => k.id === r.card)))
    : r.column
      ? workspace.boards.some((b) => b.columns.some((c) => c.id === r.column))
      : r.board
        ? workspace.boards.some((b) => b.id === r.board)
        : workspace.timers.some((t) => t.id === r.timer);
  return exists ? r : null;
}

/** The ids the agent is sent with a request whose words point (see [pointsAtSomething]); undefined otherwise. */
export function attentionFor(text: string, workspace: Workspace): Attention | undefined {
  if (!pointsAtSomething(text)) return undefined;
  const r = lookedAt(workspace);
  return r ? { board: r.board, column: r.column, card: r.card, timer: r.timer } : undefined;
}

export class AttentionSystem extends createSystem({}) {
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly point = new Vector3();
  private lastTestMs = -Infinity;
  /** The control under the gaze at the last test, and since when. */
  private panel: GazeTarget | null = null;
  private key: string | null = null;
  private since = 0;
  /** Read by the Playwright tests. */
  readonly state = { tests: 0, key: null as string | null, focus: null as Referent | null, seenAt: 0 };

  init(): void {
    (window as unknown as { __attention: unknown }).__attention = {
      state: this.state,
      lookedAt,
      pointsAtSomething,
      forget: () => { focus = null; this.state.focus = null; },
    };
  }

  update(): void {
    if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      this.panel = null;
      return;
    }
    const now = performance.now();
    if (now - this.lastTestMs < TEST_EVERY_MS) return;
    this.lastTestMs = now;
    this.state.tests++;

    let best: GazeTarget | null;
    let key: string | null;
    if (now - gazeFinding.at < TEST_EVERY_MS) {
      // Hands-free is casting this very ray every few frames: its finding is ours.
      best = gazeFinding.panel;
      key = gazeFinding.key;
    } else {
      best = this.test();
      key = best ? best.gazeHit(this.point, best !== this.panel) : null;
    }
    if (!best) {
      this.panel = null;
      this.state.key = null;
      return;
    }
    if (best !== this.panel || key !== this.key) {
      this.panel = best;
      this.key = key;
      this.since = now;
    }
    this.state.key = key;
    if (now - this.since < DWELL_MS) return;
    // A second on the same control: what it stands for, if anything, is "this". Asked again on every test, since the
    // card in a place can change under the eyes (it was moved away, another took its place).
    const referent = best.refer(key);
    if (focus && referent && sameItem(referent, focus.referent)) {
      focus.seenAt = now;
      this.state.seenAt = now;
    } else if (referent) {
      focus = { referent, seenAt: now };
      this.state.focus = referent;
      this.state.seenAt = now;
    }
  }

  /** The nearest panel on the ray from the eyes (else the head), with [point] where it meets it; panels where last drawn. */
  private test(): GazeTarget | null {
    const player = this.world.player;
    if (player.gazeOrigin === 'tracked') {
      player.eyeSpace.getWorldPosition(this.origin);
      player.eyeSpace.getWorldDirection(this.direction).negate();
    } else {
      this.world.camera.getWorldPosition(this.origin);
      this.world.camera.getWorldDirection(this.direction);
    }
    let best: GazeTarget | null = null;
    let distance = Infinity;
    for (let i = 0; i < livePanels.length; i++) {
      const t = livePanels[i].rayDistance(this.origin, this.direction, false);
      if (t > 0 && t < distance) {
        distance = t;
        best = livePanels[i];
      }
    }
    if (best) this.point.copy(this.direction).multiplyScalar(distance).add(this.origin);
    return best;
  }
}
