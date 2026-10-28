/**
 * The guided setup: three questions, one at a time, hands only, for someone who has never put a headset on.
 *   1. "Where are you sitting?"  [Desk] / [Sofa / Bed]      -> where Fit room looks for a surface (setup-state.ts)
 *   2. "Reach out and pinch this orb"                       -> the pinch's own distance, height and side become the
 *      comfort profile (src/accessibility/reach.ts); the orb is only an invitation, 50 cm from the eyes
 *   3. "Do you need pointer stabilization?"  [Yes] / [No]   -> steady aim (tremor mode, src/ui/aim.ts): the button
 *      aimed at over the last moments is the one pressed, and a tremor that leaves the panel for a moment is forgiven
 * It opens by itself the first time someone enters XR, can be skipped at any step (Skip, top right), and comes back by voice
 * ("recalibrate") or from the My setup card. The first-run coach (src/onboarding/coach.ts) waits for it. Nothing is
 * stored but the choices: the seat, the comfort profile and the steady-aim setting.
 */
import {
  createSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  PanelDocument,
  PanelUI,
  RayInteractable,
  SphereGeometry,
  VisibilityState,
  type Entity,
  type Object3D,
  type UIKit,
  type UIKitDocument,
} from '@iwsdk/core';
import { ReachSystem } from '../accessibility/reach-system.js';
import type { Reach } from '../accessibility/reach.js';
import { accessPreferences, setAccessPreference } from '../accessibility/preferences.js';
import { AgentSystem } from '../agent/agent-system.js';
import { isSpanish } from '../i18n/language.js';
import { hoverFades } from '../ui/hover.js';
import { PanelHits } from '../ui/panel-hits.js';
import { idleBorder, onSettings } from '../ui/settings.js';
import { play } from '../ui/sounds.js';
import { SetupPanel } from '../workspace/components.js';
import { panelText, type Op } from '../workspace/model.js';
import { workspace } from '../workspace/store.js';
import { deskPose } from '../workspace/viewer.js';
import { calibrated, markCalibrated, notifySetupClosed, onSetupRequested, setSeat, setupState, type Seat } from './setup-state.js';

const CONFIG = `${import.meta.env.BASE_URL}ui/setup.uikitml`;
const SIZE = { width: 0.52, height: 0.38 } as const; // public/ui/setup.uikitml
/** The panel stands this far in front of the eyes and this far above them. */
const AHEAD = 0.55;
const LIFT = 0.07;
/**
 * The orb: 50 cm from the eyes and 9 cm across, 18 degrees under the eyes' level: where a hand rests, and below the panel
 * (whose lower edge is 12 cm under that level), so it never stands in front of the question or a button. It is an invitation:
 * the pinch is measured where the hand really is, whichever seat was chosen.
 */
const ORB_DISTANCE = 0.5;
const ORB_RADIUS = 0.045;
const ORB_ELEVATION = (-18 * Math.PI) / 180;
const ORB_BREATH_MS = 1800;
const CHECK_EVERY_MS = 200;
/** After the pinch the next question waits: the pinch is released first, and the amber frame is seen. */
const AFTER_PINCH_MS = 800;
const COLOR = { choice: '#2f5f9e', skip: '#2a313b' } as const;

type Stage = 'where' | 'reach' | 'steady' | 'done';
type Key = 'a' | 'b' | 'skip';
interface Page { step: string; title: string; hint: string; a: string; b: string }

const TEXT = {
  en: {
    skip: 'Skip',
    // The first words someone reads in the headset: a welcome, and why three questions.
    where: { step: 'Step 1 of 3', title: 'Where are you sitting?', hint: 'Welcome. Three quick questions fit this space to your body. Skip any time.', a: 'Desk', b: 'Sofa/Bed' },
    reach: { step: 'Step 2 of 3', title: 'Reach out and pinch this orb', hint: 'Pinch where your hand is comfortable. It does not have to touch the orb.', a: 'Skip this step', b: '' },
    reachDone: 'Got it. Your space will fit where your hand reached when you press Start.',
    nearer: 'A little further out, then pinch.',
    steady: { step: 'Step 3 of 3', title: 'Do you need pointer stabilization?', hint: 'It helps if your hand shakes: the button you aim at is the one pressed.', a: 'Yes', b: 'No' },
    done: { step: 'All set', title: 'Your space is ready', a: 'Start', b: '' },
    summary: (seat: string, cm: number, steady: boolean) =>
      `${seat}${cm ? `, board ${cm} cm away` : ''}${steady ? ', steady aim on' : ''}. Say "recalibrate" to do this again.`,
    seats: { desk: 'Desk', sofa: 'Sofa/Bed' },
    applied: 'Your space now fits where your hand reached. Say undo to put it back.',
    noReach: 'No problem. Say "fit to my reach" whenever you want it measured.',
    flat: 'The reach step needs VR. Say "fit to my reach" once you are in.',
    finished: 'Setup saved. Say "recalibrate" any time to change it.',
    skipped: 'Skipped. Say "recalibrate" any time to set up your space.',
  },
  es: {
    skip: 'Saltar',
    where: { step: 'Paso 1 de 3', title: '¿Dónde te sientas?', hint: 'Te damos la bienvenida. Tres preguntas rápidas ajustan este espacio a tu cuerpo.', a: 'Escritorio', b: 'Sofá/Cama' },
    reach: { step: 'Paso 2 de 3', title: 'Estira la mano y pellizca este orbe', hint: 'Pellizca donde tu mano esté cómoda. No hace falta tocar el orbe.', a: 'Saltar este paso', b: '' },
    reachDone: 'Hecho. Tu espacio se ajustará a donde llegó tu mano cuando pulses Empezar.',
    nearer: 'Un poco más lejos, y pellizca.',
    steady: { step: 'Paso 3 de 3', title: '¿Necesitas estabilizar el puntero?', hint: 'Ayuda si te tiembla la mano: se pulsa el botón al que apuntas.', a: 'Sí', b: 'No' },
    done: { step: 'Listo', title: 'Tu espacio está preparado', a: 'Empezar', b: '' },
    summary: (seat: string, cm: number, steady: boolean) =>
      `${seat}${cm ? `, tablero a ${cm} cm` : ''}${steady ? ', puntería estable' : ''}. Di "recalibrar" para repetirlo.`,
    seats: { desk: 'Escritorio', sofa: 'Sofá/Cama' },
    applied: 'Tu espacio ya se ajusta a donde llegó tu mano. Di deshacer para volver atrás.',
    noReach: 'No pasa nada. Di "ponlo a mi alcance" cuando quieras medirlo.',
    flat: 'El paso del alcance necesita VR. Di "ponlo a mi alcance" cuando estés dentro.',
    finished: 'Ajuste guardado. Di "recalibrar" cuando quieras cambiarlo.',
    skipped: 'Saltado. Di "recalibrar" cuando quieras ajustar tu espacio.',
  },
} as const;

interface Elements {
  root: UIKit.Text;
  step: UIKit.Text;
  title: UIKit.Text;
  hint: UIKit.Text;
  a: UIKit.Text;
  aLabel: UIKit.Text;
  b: UIKit.Text;
  bLabel: UIKit.Text;
  skip: UIKit.Text;
  skipLabel: UIKit.Text;
}

export class SetupSystem extends createSystem({ ready: { required: [SetupPanel, PanelDocument] } }) {
  private entity: Entity | null = null;
  private orb!: Entity;
  private elements: Elements | null = null;
  private stage: Stage | null = null;
  private seat: Seat = 'desk';
  private steady = false;
  private reachDone = false;
  private autoShown = false;
  private nextCheck = 0;
  private advance: ReturnType<typeof setTimeout> | null = null;
  private readonly hovered = new Set<Key>();
  private readonly cleanups: (() => void)[] = [];
  /** Read by the Playwright tests. */
  readonly view = {
    stage: null as Stage | null,
    seat: null as Seat | null,
    reach: null as Reach | null,
    steady: null as boolean | null,
    finished: false,
    skipped: false,
    step: '',
    title: '',
    hint: '',
    a: '',
    b: '',
  };

  init(): void {
    (window as unknown as { __setup: SetupSystem }).__setup = this;
    // Transparent and drawn over the panels, like the amber dots on the hands (UIKit draws in the transparent pass).
    const material = new MeshBasicMaterial({ color: '#ffb020', transparent: true, opacity: 0.92, depthTest: false, depthWrite: false, toneMapped: false });
    const mesh = new Mesh(new SphereGeometry(ORB_RADIUS, 24, 16), material);
    mesh.name = 'setup-orb';
    mesh.renderOrder = 997;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.orb = this.world.createTransformEntity(mesh);
    this.queries.ready.subscribe('qualify', (entity) => this.bind(entity));
    this.cleanupFuncs.push(
      onSetupRequested(() => this.start()),
      // Fires now and at every change: the first time someone is in XR and has not been through it, it opens.
      this.world.visibilityState.subscribe(() => this.enteredXR()),
      () => this.cleanups.forEach((cleanup) => cleanup()),
      () => {
        if (this.advance) clearTimeout(this.advance);
      },
    );
    // A link that opens it, for whoever helps set up a space on a screen.
    if (new URLSearchParams(location.search).has('setup')) this.start();
  }

  update(): void {
    if (!this.stage) return;
    const now = performance.now();
    if (this.stage === 'reach' && !this.reachDone && !accessPreferences.reducedMotion) {
      this.orb.object3D!.scale.setScalar(1 + 0.1 * Math.sin((now / ORB_BREATH_MS) * 2 * Math.PI)); // a slow breath: here
    }
    if (now < this.nextCheck) return;
    this.nextCheck = now + CHECK_EVERY_MS;
    this.place();
  }

  /** Opens at the first question; a setup already open stays where it is. */
  start(): void {
    if (this.stage) return;
    this.world.getSystem(AgentSystem)?.dismiss();
    this.ensurePanel();
    setupState.active = true;
    this.reachDone = false;
    this.view.finished = false;
    this.view.skipped = false;
    this.view.reach = null;
    this.view.steady = null;
    this.setShown(true);
    this.go('where');
  }

  /** A press on a control, by key: the pointer, the gaze, the switch and the tests all come through here. */
  choose(key: Key): void {
    if (!this.stage) return;
    if (key === 'skip') {
      this.finish(true);
      return;
    }
    switch (this.stage) {
      case 'where':
        this.seat = key === 'a' ? 'desk' : 'sofa';
        this.view.seat = this.seat;
        setSeat(this.seat);
        this.go('reach');
        return;
      case 'reach':
        if (key === 'a') this.world.getSystem(ReachSystem)?.cancel(); // "skip this step": the capture reports it ended
        return;
      case 'steady':
        this.steady = key === 'a';
        this.view.steady = this.steady;
        setAccessPreference('tremorTolerance', this.steady);
        this.go('done');
        return;
      case 'done':
        if (key === 'a') this.finish(false);
        return;
    }
  }

  private enteredXR(): void {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (!immersive || this.stage || this.autoShown || calibrated()) return;
    this.autoShown = true;
    this.start();
  }

  private go(stage: Stage): void {
    if (this.advance) clearTimeout(this.advance);
    this.advance = null;
    this.stage = stage;
    this.view.stage = stage;
    this.reachDone = false;
    this.orb.object3D!.visible = false;
    if (stage === 'reach' && !this.startReach()) {
      workspace.notify({ text: this.text().flat, error: false });
      this.go('steady'); // no hands, no orb: a flat screen goes on to the last question
      return;
    }
    this.render();
    this.place();
  }

  /** The reach measurement, with this setup as the one who takes it. False on a flat screen, where there are no hands. */
  private startReach(): boolean {
    const reach = this.world.getSystem(ReachSystem);
    if (!reach) return false;
    const started = reach.start({
      measured: (measured) => this.measured(measured),
      refused: () => {
        this.elements?.hint.setProperties({ text: panelText(this.text().nearer) });
      },
      cancelled: () => {
        if (this.stage !== 'reach') return;
        workspace.notify({ text: this.text().noReach, error: false });
        this.go('steady');
      },
    });
    if (started) this.orb.object3D!.visible = true;
    return started;
  }

  /**
   * The pinch: noted, not applied yet. The boards would come to the hand's distance (about 45 cm), in front of this panel
   * (55 cm), covering it and taking the ray meant for its buttons; so the space moves when Start is pressed.
   */
  private measured(reach: Reach): void {
    this.view.reach = reach;
    this.reachDone = true;
    play('pick');
    this.orb.object3D!.visible = false;
    this.elements?.hint.setProperties({ text: panelText(this.text().reachDone) });
    this.advance = setTimeout(() => this.go('steady'), AFTER_PINCH_MS);
  }

  /** The measured reach, height and side become the comfort profile, in one Undo: the amber frame and the pulse follow. */
  private commit(reach: Reach): void {
    const c = reach.comfort;
    const before = workspace.state.comfort;
    const ops: Op[] = [];
    if (before.reach !== c.reach) ops.push({ op: 'set_comfort', reach: c.reach });
    if (before.tiltDeg !== c.tiltDeg) ops.push({ op: 'set_comfort', tiltDeg: c.tiltDeg });
    if (before.side !== c.side) ops.push({ op: 'set_comfort', side: c.side });
    if (ops.length) workspace.dispatch(ops, { label: 'Guided setup', viewer: deskPose(this.world), notice: this.text().applied });
    play('apply');
  }

  private finish(skipped: boolean): void {
    if (this.advance) clearTimeout(this.advance);
    this.advance = null;
    this.stage = null;
    this.view.stage = null;
    this.view.finished = true;
    this.view.skipped = skipped;
    markCalibrated();
    setupState.active = false;
    this.world.getSystem(ReachSystem)?.cancel(); // a measurement still waiting for a pinch ends with the setup
    this.orb.object3D!.visible = false;
    this.setShown(false);
    const measured = this.view.reach;
    if (!skipped && measured) this.commit(measured); // Skip leaves the space as it was
    workspace.notify({ text: skipped ? this.text().skipped : this.text().finished, error: false });
    notifySetupClosed(skipped);
  }

  private text(): (typeof TEXT)['en'] | (typeof TEXT)['es'] {
    return isSpanish() ? TEXT.es : TEXT.en;
  }

  private page(stage: Stage): Page {
    const t = this.text();
    if (stage === 'done') {
      const cm = this.view.reach ? Math.round(this.view.reach.comfort.reach * 62) : 0;
      return { ...t.done, hint: t.summary(t.seats[this.seat], cm, this.steady) };
    }
    return t[stage];
  }

  private render(): void {
    const el = this.elements;
    if (!el || !this.stage) return;
    const page = this.page(this.stage);
    const text = (value: string) => panelText(value);
    el.step.setProperties({ text: text(page.step) });
    el.title.setProperties({ text: text(page.title) });
    el.hint.setProperties({ text: text(this.stage === 'reach' && this.reachDone ? this.text().reachDone : page.hint) });
    el.aLabel.setProperties({ text: text(page.a) });
    el.bLabel.setProperties({ text: text(page.b) });
    el.b.setProperties({ display: page.b ? 'flex' : 'none' });
    el.skipLabel.setProperties({ text: text(this.text().skip) });
    this.view.step = text(page.step);
    this.view.title = text(page.title);
    this.view.hint = text(page.hint);
    this.view.a = text(page.a);
    this.view.b = text(page.b);
    this.paint();
  }

  private paint(): void {
    const el = this.elements;
    if (!el) return;
    const items: readonly (readonly [Key, UIKit.Text, string])[] = [['a', el.a, COLOR.choice], ['b', el.b, COLOR.choice], ['skip', el.skip, COLOR.skip]];
    for (const [key, element, base] of items) {
      element.setProperties({ borderColor: idleBorder(base) });
      hoverFades.paint(element, base, this.hovered.has(key));
    }
  }

  /** In front of the eyes and facing them, wherever the workspace's anchor is now (it moves when XR starts). */
  private place(): void {
    const anchor = workspace.state.anchor;
    const sin = Math.sin(anchor.yaw);
    const cos = Math.cos(anchor.yaw);
    const panel = this.entity?.object3D;
    if (panel) {
      panel.position.set(anchor.x - sin * AHEAD, anchor.y + LIFT, anchor.z - cos * AHEAD);
      panel.rotation.set(0, anchor.yaw, 0);
      panel.scale.setScalar(workspace.panelScale);
    }
    const flat = ORB_DISTANCE * Math.cos(ORB_ELEVATION);
    this.orb.object3D!.position.set(anchor.x - sin * flat, anchor.y + ORB_DISTANCE * Math.sin(ORB_ELEVATION), anchor.z - cos * flat);
  }

  private ensurePanel(): void {
    if (this.entity) return;
    const entity = this.world.createTransformEntity(new Group());
    entity.object3D!.rotation.order = 'YXZ';
    entity.addComponent(PanelUI, { config: CONFIG });
    entity.addComponent(RayInteractable);
    entity.addComponent(SetupPanel);
    this.entity = entity;
  }

  private setShown(shown: boolean): void {
    const object = this.entity?.object3D as (Object3D & { pointerEvents?: string }) | undefined;
    if (!object) return;
    // Not drawn until its own words are in (bind): no frame of the layout file's default text.
    object.visible = shown && this.elements !== null;
    object.pointerEvents = shown ? undefined : 'none'; // undefined: back to pointer-events' default (only listeners)
  }

  private bind(entity: Entity): void {
    const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
    if (!document || this.elements) return;
    document.setTargetDimensions(SIZE.width, SIZE.height);
    const get = (id: string) => {
      const element = document.querySelector(`#${id}`) as UIKit.Text | null;
      if (!element) throw new Error(`setup.uikitml has no #${id}`);
      element.name = `setup:${id}`;
      return element;
    };
    const el: Elements = {
      root: get('setup-root'),
      step: get('setup-step'),
      title: get('setup-title'),
      hint: get('setup-hint'),
      a: get('setup-a'),
      aLabel: get('setup-a-label'),
      b: get('setup-b'),
      bLabel: get('setup-b-label'),
      skip: get('setup-skip'),
      skipLabel: get('setup-skip-label'),
    };
    this.elements = el;
    this.cleanups.push(onSettings(() => this.paint()));
    new PanelHits(
      el.root,
      [['a', el.a], ['b', el.b], ['skip', el.skip]] as const,
      {
        click: (key) => this.choose(key),
        hover: (key, hovered) => {
          if (hovered) this.hovered.add(key);
          else this.hovered.delete(key);
          this.paint();
        },
      },
      this.cleanups,
      { name: 'setup', modal: true },
    );
    this.setShown(setupState.active);
    this.render();
    this.place();
  }
}
