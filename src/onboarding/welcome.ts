/**
 * Welcome back: the first seconds in the headset say what to do. Someone new gets the guided setup instead (its first
 * line is a welcome) and then the first-run coach; someone who has been here before gets one quiet banner above the
 * work board: "Welcome back. Say 'Plan my day', or pinch it on your panel." It fades in, stays nine seconds, and goes as
 * soon as the person does anything (any change of theirs to the space, the setup or the helper panel opening).
 *
 * Nothing on it can be pressed, so it never takes a ray or a gaze meant for the board under it, and it is only drawn
 * while it shows: nothing per frame once it has gone.
 */
import { createSystem, Group, Object3D, PanelDocument, PanelUI, Vector3, VisibilityState, type Entity, type UIKit, type UIKitDocument } from '@iwsdk/core';
import { helperState } from '../assist/helper-state.js';
import { isSpanish } from '../i18n/language.js';
import { WelcomePanel } from '../workspace/components.js';
import { BOARD_SIZE, panelText, TIMER_SIZE } from '../workspace/model.js';
import { workspace } from '../workspace/store.js';
import { calibrated, setupState } from './setup-state.js';

const CONFIG = `${import.meta.env.BASE_URL}ui/welcome.uikitml`;
const SIZE = { width: 0.52, height: 0.11 } as const; // public/ui/welcome.uikitml
const SHOW_MS = 9_000;
const FADE_IN_MS = 400;
const FADE_OUT_MS = 600;
const PLACE_EVERY_MS = 250;
const ONBOARDED_KEY = 'spatialdesk.onboarded';

const TEXT = {
  en: { title: 'Welcome back', line: 'Say "Plan my day", or pinch it on your panel.' },
  es: { title: 'Hola de nuevo', line: 'Di "planifica mi dia", o pulsalo en tu panel.' },
} as const;

function onboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

type Phase = 'hidden' | 'in' | 'shown' | 'out';

export class WelcomeSystem extends createSystem({ ready: { required: [WelcomePanel, PanelDocument] } }) {
  private entity: Entity | null = null;
  private root: UIKit.Text | null = null;
  private phase: Phase = 'hidden';
  private phaseAt = 0;
  private nextPlace = 0;
  private greeted = false;
  private readonly up = new Vector3();
  private readonly helper = new Object3D();
  /** Read by the Playwright tests. */
  readonly view = { shown: false, greeted: false, title: '', line: '' };

  init(): void {
    (window as unknown as { __welcome: WelcomeSystem['view'] }).__welcome = this.view;
    this.queries.ready.subscribe('qualify', (entity) => this.bind(entity));
    this.cleanupFuncs.push(
      // Fires now and at every change: the first time in the headset in this visit.
      this.world.visibilityState.subscribe((state) => {
        if (state !== VisibilityState.NonImmersive) this.greet();
      }),
      // The person has started: the welcome has done its job.
      workspace.subscribe(({ source }) => {
        if (source === 'user' || source === 'undo') this.dismiss();
      }),
    );
  }

  update(): void {
    if (this.phase === 'hidden' || !this.root) return;
    const now = performance.now();
    const t = now - this.phaseAt;
    if (this.phase !== 'out' && (setupState.active || helperState.open || t > SHOW_MS)) this.dismiss();
    if (this.phase === 'in') {
      this.setOpacity(Math.min(1, t / FADE_IN_MS));
      if (t >= FADE_IN_MS) this.phase = 'shown';
    } else if (this.phase === 'out') {
      this.setOpacity(Math.max(0, 1 - t / FADE_OUT_MS));
      if (t >= FADE_OUT_MS) this.hide();
      return;
    }
    if (now >= this.nextPlace) {
      this.nextPlace = now + PLACE_EVERY_MS;
      this.place();
    }
  }

  /** Once per visit, for someone who has been through the setup and the first-run coach. */
  private greet(): void {
    if (this.greeted || !calibrated() || !onboarded() || setupState.active) return;
    this.greeted = true;
    this.view.greeted = true;
    if (!this.entity) {
      const entity = this.world.createTransformEntity(new Group());
      entity.object3D!.rotation.order = 'YXZ';
      entity.object3D!.visible = false; // until its words are in: no frame of the file's default text
      entity.addComponent(PanelUI, { config: CONFIG });
      entity.addComponent(WelcomePanel);
      this.entity = entity;
    }
    this.phase = 'in';
    this.phaseAt = performance.now();
    if (this.root) this.show();
  }

  private dismiss(): void {
    if (this.phase === 'in' || this.phase === 'shown') {
      this.phase = 'out';
      this.phaseAt = performance.now();
    }
  }

  private show(): void {
    const object = this.entity?.object3D;
    if (!object) return;
    this.place();
    this.setOpacity(0);
    object.visible = true;
    this.view.shown = true;
  }

  private hide(): void {
    this.phase = 'hidden';
    if (this.entity?.object3D) this.entity.object3D.visible = false;
    this.view.shown = false;
  }

  private setOpacity(value: number): void {
    this.root?.setProperties({ opacity: value });
  }

  /** Above the work board (and above its timer, when one runs), tilted with it. */
  private place(): void {
    const ws = workspace.state;
    const board = ws.boards.find((b) => b.id === ws.focusBoardId) ?? ws.boards[0];
    const object = this.entity?.object3D;
    if (!board || !object) return;
    const p = board.pose;
    this.helper.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    this.up.set(0, 1, 0).applyEuler(this.helper.rotation);
    const scale = workspace.panelScale;
    const timer = ws.timers.length > 0 ? TIMER_SIZE.height + 0.02 : 0;
    const lift = (BOARD_SIZE.height / 2 + 0.03 + timer + SIZE.height / 2) * scale;
    object.position.set(p.x + this.up.x * lift, p.y + this.up.y * lift, p.z + this.up.z * lift);
    object.rotation.set(p.pitch, p.yaw, 0);
    object.scale.setScalar(scale);
  }

  private bind(entity: Entity): void {
    const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
    if (!document || this.root) return;
    document.setTargetDimensions(SIZE.width, SIZE.height);
    const get = (id: string) => {
      const element = document.querySelector(`#${id}`) as UIKit.Text | null;
      if (!element) throw new Error(`welcome.uikitml has no #${id}`);
      element.name = `welcome:${id.replace(/^welcome-/, '')}`;
      return element;
    };
    this.root = get('welcome-root');
    const t = isSpanish() ? TEXT.es : TEXT.en;
    get('welcome-title').setProperties({ text: panelText(t.title) });
    get('welcome-line').setProperties({ text: panelText(t.line) });
    this.view.title = panelText(t.title);
    this.view.line = panelText(t.line);
    if (this.phase === 'in' || this.phase === 'shown') this.show();
  }
}
