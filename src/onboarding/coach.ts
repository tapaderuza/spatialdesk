/**
 * The first five minutes: a three-step guided start that takes under a minute, hands only. One line above the focus
 * board says what to do next and the target glows amber (a card, the Doing column, then Focus 25); each step ends
 * when the user has done it, not when they press Next. Skippable, and never shown again once done.
 */
import {
  createSystem,
  Group,
  Object3D,
  PanelDocument,
  PanelUI,
  PokeInteractable,
  RayInteractable,
  Vector3,
  type Entity,
  type UIKit,
  type UIKitDocument,
} from '@iwsdk/core';
import { setCommandHighlight } from '../panel.js';
import { hoverFades } from '../ui/hover.js';
import { PanelHits } from '../ui/panel-hits.js';
import { idleBorder, onSettings } from '../ui/settings.js';
import { play } from '../ui/sounds.js';
import { heldCard, setCoachTarget } from '../workspace/boards.js';
import { CoachPanel } from '../workspace/components.js';
import { BOARD_SIZE } from '../workspace/model.js';
import { workspace } from '../workspace/store.js';

const CONFIG = `${import.meta.env.BASE_URL}ui/coach.uikitml`;
const SIZE = { width: 0.44, height: 0.1 } as const; // public/ui/coach.uikitml
const KEY = 'spatialdesk.onboarded';
const CHECK_EVERY_MS = 200;

interface Step {
  text: string;
  target: (focusBoardId: string) => void;
  /** Done once the user has done it. [startedAt] is when the step began. */
  done: (startedAt: number, timersAtStart: number) => boolean;
}

const STEPS: Step[] = [
  {
    text: '1 of 3: tap a card to pick it up.',
    target: (board) => setCoachTarget({ boardId: board, key: 'card-0-0' }),
    done: () => heldCard() != null,
  },
  {
    text: '2 of 3: now tap the Doing column to drop it there.',
    target: (board) => setCoachTarget({ boardId: board, key: 'col-1' }),
    done: (startedAt) => {
      const board = workspace.state.boards.find((b) => b.id === workspace.state.focusBoardId);
      return board?.columns[1]?.cards.some((c) => (c.since ?? 0) >= startedAt) ?? false;
    },
  },
  {
    text: '3 of 3: press Focus 25 on the left panel.',
    target: () => {
      setCoachTarget(null);
      setCommandHighlight('focus');
    },
    done: (_, timersAtStart) => workspace.state.timers.length > timersAtStart,
  },
];

function onboarded(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export class CoachSystem extends createSystem({ ready: { required: [CoachPanel, PanelDocument] } }) {
  private entity: Entity | null = null;
  private text: UIKit.Text | null = null;
  private step = -1;
  private stepStartedAt = 0;
  private timersAtStart = 0;
  private startedAt = 0;
  private nextCheck = 0;
  private readonly cleanups: (() => void)[] = [];
  private readonly up = new Vector3();
  private readonly helper = new Object3D();

  init(): void {
    const w = window as unknown as { __onboarding: { done: boolean; ms: number | null; skipped: boolean } };
    w.__onboarding = { done: onboarded(), ms: null, skipped: false };
    if (onboarded()) return;
    this.entity = this.world.createTransformEntity(new Group());
    this.entity.object3D!.rotation.order = 'YXZ';
    this.entity.addComponent(PanelUI, { config: CONFIG });
    this.entity.addComponent(RayInteractable);
    this.entity.addComponent(PokeInteractable);
    this.entity.addComponent(CoachPanel);
    this.queries.ready.subscribe('qualify', (entity) => {
      const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
      if (!document || this.text) return;
      document.setTargetDimensions(SIZE.width, SIZE.height);
      this.bind(document);
      this.startedAt = performance.now();
      this.go(0);
    });
    this.cleanupFuncs.push(() => this.cleanups.forEach((cleanup) => cleanup()));
  }

  update(): void {
    if (this.step < 0 || !this.text) return;
    const now = performance.now();
    if (now < this.nextCheck) return;
    this.nextCheck = now + CHECK_EVERY_MS;
    this.place();
    // Focus 25 is the last step: started early (by voice, say), it ends the guided start too, and its timer takes
    // the row above the board where this line sits.
    if (this.step < STEPS.length - 1 && workspace.state.timers.length > this.timersAtStart) {
      play('apply');
      this.go(STEPS.length);
      return;
    }
    if (STEPS[this.step].done(this.stepStartedAt, this.timersAtStart)) {
      play('apply');
      this.go(this.step + 1);
    }
  }

  skip(): void {
    (window as unknown as { __onboarding: { skipped: boolean } }).__onboarding.skipped = true;
    this.finish('Skipped. The cards on "Getting started" explain the rest.');
  }

  private go(step: number): void {
    if (step >= STEPS.length) {
      this.finish('You are set. Ask the AI with Plan my day whenever you like.');
      return;
    }
    this.step = step;
    this.stepStartedAt = Date.now();
    this.timersAtStart = workspace.state.timers.length;
    this.text?.setProperties({ text: STEPS[step].text });
    const focus = workspace.state.focusBoardId;
    if (focus) STEPS[step].target(focus);
    this.place();
  }

  private finish(notice: string): void {
    this.step = -1;
    setCoachTarget(null);
    setCommandHighlight(null);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // private mode: the coach may show again next visit
    }
    const w = window as unknown as { __onboarding: { done: boolean; ms: number | null } };
    w.__onboarding.done = true;
    w.__onboarding.ms = Math.round(performance.now() - this.startedAt);
    if (this.entity) {
      this.entity.object3D!.visible = false;
      (this.entity.object3D! as Object3D & { pointerEvents?: string }).pointerEvents = 'none';
    }
    workspace.notify({ text: notice, error: false });
  }

  /** Just above the focus board, tilted with it, so the instruction sits next to what it talks about. */
  private place(): void {
    const board = workspace.state.boards.find((b) => b.id === workspace.state.focusBoardId);
    const object = this.entity?.object3D;
    if (!board || !object) return;
    const p = board.pose;
    this.helper.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    this.up.set(0, 1, 0).applyEuler(this.helper.rotation);
    const scale = workspace.panelScale; // as the board: smaller in a narrower view (Layout.kt)
    const lift = (BOARD_SIZE.height / 2 + 0.02 + SIZE.height / 2) * scale;
    object.position.set(p.x + this.up.x * lift, p.y + this.up.y * lift, p.z + this.up.z * lift);
    object.rotation.set(p.pitch, p.yaw, 0);
    object.scale.setScalar(scale);
  }

  private bind(document: UIKitDocument): void {
    const get = (id: string) => {
      const element = document.querySelector(`#${id}`) as UIKit.Text | null;
      if (!element) throw new Error(`coach.uikitml has no #${id}`);
      element.name = `coach:${id}`;
      return element;
    };
    this.text = get('coach-text');
    const skip = get('coach-skip');
    const paint = (hovered = false) => {
      skip.setProperties({ borderColor: idleBorder('#2a313b') });
      hoverFades.paint(skip, '#2a313b', hovered); // src/ui/hover.ts
    };
    paint();
    this.cleanups.push(onSettings(() => paint()));
    new PanelHits(get('coach-root'), [['skip', skip]] as const, { click: () => this.skip(), hover: (_, hovered) => paint(hovered) }, this.cleanups, { name: 'coach', modal: true });
  }
}
