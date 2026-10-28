/**
 * The helper panel: the headset's side of letting a family member or carer follow along from a phone or a computer
 * (companion.html). It shows what the owner needs to decide, in the same big-button style as the guided setup:
 *   - a code to type on the other screen, good for two minutes                         [New code] [Stop]
 *   - "a helper is asking": nothing is shared until the owner presses Allow             [Allow] [No]
 *   - "helper connected": the Today board's card titles are being shared                [Stop sharing] [Close]
 * and, when the helper presses Help / Recalibrate on their screen, it gets out of the way: the guided setup opens, with its
 * orb, and the owner can skip any step. The protocol and state are src/assist/pairing.ts; this file is only the panel.
 * It works on a flat screen and in the headset alike, and it pops up by itself only when someone is asking to be allowed.
 */
import {
  createSystem,
  Group,
  PanelDocument,
  PanelUI,
  PokeInteractable,
  RayInteractable,
  type Entity,
  type Object3D,
  type UIKit,
  type UIKitDocument,
} from '@iwsdk/core';
import { AgentSystem } from '../agent/agent-system.js';
import { activeSession } from '../backend/link.js';
import { manualModeNotice } from '../backend/resilience.js';
import { isSpanish } from '../i18n/language.js';
import { onSetupClosed, requestSetup, setupState } from '../onboarding/setup-state.js';
import { hoverFades } from '../ui/hover.js';
import { PanelHits } from '../ui/panel-hits.js';
import { idleBorder, onSettings } from '../ui/settings.js';
import { play } from '../ui/sounds.js';
import { HelperPanel } from '../workspace/components.js';
import { panelText } from '../workspace/model.js';
import { workspace } from '../workspace/store.js';
import { assistApi } from './api.js';
import { helperState, onInviteRequested } from './helper-state.js';
import { Pairing, type PairingStage } from './pairing.js';
import { todayTasks } from './today.js';

/** The same layout as the guided setup: a title, a line of help, two big choices and a small button top right. */
const CONFIG = `${import.meta.env.BASE_URL}ui/setup.uikitml`;
const SIZE = { width: 0.52, height: 0.38 } as const;
const AHEAD = 0.55;
const LIFT = 0.07;
const CHECK_EVERY_MS = 250;
const COLOR = { choice: '#2f5f9e', stop: '#7a3b3b', quiet: '#2a313b' } as const;

type Key = 'a' | 'b' | 'skip';
interface Page { step: string; title: string; hint: string; a: string; b: string; aColor: string }

const TEXT = {
  en: {
    close: 'Close',
    invite: { step: 'Invite a helper', a: 'New code', b: 'Stop' },
    inviteTitle: (code: string) => `Code ${code}`,
    inviteHint: (where: string) => `On their phone or computer, go to ${where} and type it.`,
    asking: { step: 'A helper is asking', title: 'Show your Today board?', a: 'Allow', b: 'No' },
    askingHint: (cards: number) => `They would see ${cards} card title${cards === 1 ? '' : 's'}. Nothing else, and you can stop any time.`,
    sharing: { step: 'Helper connected', title: 'Sharing your Today board', a: 'Stop sharing', b: 'Close' },
    sharingHint: (cards: number, minutes: number) => `${cards} card${cards === 1 ? '' : 's'} shared. Their Help button opens your setup. ${minutes} min left.`,
    ended: { step: 'Helper', title: 'Sharing ended', a: 'New code', b: 'Close' },
    reasons: {
      stopped: 'Nobody can see your board now.',
      time: 'The 15 minutes are up. Nobody can see your board now.',
      invite: 'Nobody used the code in time.',
      offline: 'No connection to the command server. Your space works by hand.',
      network: manualModeNotice,
      limit: 'Close an earlier invitation first.',
    },
    helpAsked: 'Your helper asked for help setting up. You can skip any step.',
    helperBack: 'A helper is asking to see your Today board.',
  },
  es: {
    close: 'Cerrar',
    invite: { step: 'Invitar a un ayudante', a: 'Otro codigo', b: 'Parar' },
    inviteTitle: (code: string) => `Codigo ${code}`,
    inviteHint: (where: string) => `En su movil u ordenador, entra en ${where} y escribelo.`,
    asking: { step: 'Un ayudante pregunta', title: 'Mostrar tu tablero de hoy?', a: 'Permitir', b: 'No' },
    askingHint: (cards: number) => `Veria ${cards} titulo${cards === 1 ? '' : 's'} de tarjetas. Nada mas, y puedes parar cuando quieras.`,
    sharing: { step: 'Ayudante conectado', title: 'Compartiendo tu tablero de hoy', a: 'Dejar de compartir', b: 'Cerrar' },
    sharingHint: (cards: number, minutes: number) => `${cards} tarjeta${cards === 1 ? '' : 's'} compartida${cards === 1 ? '' : 's'}. Su boton Ayuda abre tu ajuste. Quedan ${minutes} min.`,
    ended: { step: 'Ayudante', title: 'Se acabo de compartir', a: 'Otro codigo', b: 'Cerrar' },
    reasons: {
      stopped: 'Nadie puede ver tu tablero ahora.',
      time: 'Pasaron los 15 minutos. Nadie puede ver tu tablero ahora.',
      invite: 'Nadie uso el codigo a tiempo.',
      offline: 'Sin conexion con el servidor. Tu espacio funciona a mano.',
      network: manualModeNotice,
      limit: 'Cierra antes la invitacion anterior.',
    },
    helpAsked: 'Tu ayudante pidio ayuda para ajustar el espacio. Puedes saltar cualquier paso.',
    helperBack: 'Un ayudante pide ver tu tablero de hoy.',
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

export class HelperSystem extends createSystem({ ready: { required: [HelperPanel, PanelDocument] } }) {
  private entity: Entity | null = null;
  private elements: Elements | null = null;
  private pairing!: Pairing;
  /** Opened by the owner (or by a request they must answer) and not closed since; hidden meanwhile when the setup is up. */
  private opened = false;
  private shown = false;
  private lastStage: PairingStage = 'idle';
  private lastHelpCalls = 0;
  private lastKey = '';
  private nextCheck = 0;
  private readonly hovered = new Set<Key>();
  private readonly cleanups: (() => void)[] = [];
  /** Read by the Playwright tests. */
  readonly view = { open: false, stage: 'idle' as PairingStage, step: '', title: '', hint: '', a: '', b: '' };

  get state(): Pairing['view'] {
    return this.pairing.view;
  }

  init(): void {
    (window as unknown as { __helper: HelperSystem }).__helper = this;
    this.pairing = new Pairing({
      api: assistApi,
      session: activeSession,
      tasks: () => todayTasks(workspace.state).tasks,
      openSetup: requestSetup,
      onSetupClosed,
    });
    this.queries.ready.subscribe('qualify', (entity) => this.bind(entity));
    this.cleanupFuncs.push(
      this.pairing.onChange(() => this.changed()),
      onInviteRequested(() => this.open()),
      () => this.pairing.dispose(),
      () => this.cleanups.forEach((cleanup) => cleanup()),
    );
  }

  update(): void {
    const now = performance.now();
    if (now < this.nextCheck) return;
    this.nextCheck = now + CHECK_EVERY_MS;
    // The guided setup (a helper's call opens it) has the stage; this panel waits behind it and comes back after.
    const want = this.opened && !setupState.active;
    if (want !== this.shown) this.setShown(want);
    if (this.shown) {
      this.render(); // the countdown, when its second has changed
      this.place();
    }
  }

  /** "Invite a helper": shows the panel, with a fresh code unless a sharing is already going. */
  open(): void {
    this.world.getSystem(AgentSystem)?.dismiss();
    this.ensurePanel();
    this.opened = true;
    this.setShown(!setupState.active);
    const stage = this.pairing.view.stage;
    if (stage === 'idle' || stage === 'ended') void this.pairing.invite();
    this.render(true);
    this.place();
  }

  /** A press on a control, by key: the pointer, the gaze, the switch and the tests all come through here. */
  choose(key: Key): void {
    if (!this.opened) return;
    const stage = this.pairing.view.stage;
    if (key === 'skip') return this.hide();
    if (stage === 'asking') {
      if (key === 'a') void this.pairing.allow();
      else void this.pairing.stop();
    } else if (stage === 'sharing') {
      if (key === 'a') void this.pairing.stop();
      else this.hide();
    } else if (stage === 'inviting') {
      if (key === 'a') {
        void this.pairing.invite();
      } else {
        void this.pairing.stop();
        this.hide();
      }
    } else if (key === 'a') {
      void this.pairing.invite();
    } else {
      this.hide();
    }
  }

  private hide(): void {
    this.opened = false;
    this.setShown(false);
    this.render(true);
  }

  /** The pairing changed: pop up when someone is asking, tell the owner when a helper calls, keep the panel true. */
  private changed(): void {
    const view = this.pairing.view;
    if (view.stage === 'asking' && this.lastStage !== 'asking') {
      play('nudge');
      if (!this.opened) {
        workspace.notify({ text: this.text().helperBack, error: false });
        this.open();
      }
    }
    if (view.helpCalls > this.lastHelpCalls) workspace.notify({ text: this.text().helpAsked, error: false });
    if (view.stage === 'sharing' && this.lastStage === 'asking') play('apply');
    this.lastStage = view.stage;
    this.lastHelpCalls = view.helpCalls;
    this.render(true);
  }

  private text(): (typeof TEXT)['en'] | (typeof TEXT)['es'] {
    return isSpanish() ? TEXT.es : TEXT.en;
  }

  private page(): Page {
    const t = this.text();
    const view = this.pairing.view;
    switch (view.stage) {
      case 'asking':
        return { ...t.asking, hint: t.askingHint(view.shared || todayTasks(workspace.state).tasks.length), aColor: COLOR.choice };
      case 'sharing':
        return { ...t.sharing, hint: t.sharingHint(view.shared, Math.max(1, Math.ceil(view.roomLeftMs / 60_000))), aColor: COLOR.stop };
      case 'ended':
        return { ...t.ended, hint: view.reason ? this.reason(view.reason) : '', aColor: COLOR.choice };
      default: {
        const seconds = Math.max(0, Math.ceil(view.inviteLeftMs / 1000));
        const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        return { step: `${t.invite.step}  ${clock}`, title: view.code ? t.inviteTitle(view.code) : '...', hint: t.inviteHint(`${location.host}/companion.html`), a: t.invite.a, b: t.invite.b, aColor: COLOR.choice };
      }
    }
  }

  private reason(reason: NonNullable<Pairing['view']['reason']>): string {
    const value = this.text().reasons[reason];
    return typeof value === 'function' ? value() : value;
  }

  /** Writes the page into the panel; skipped when nothing it shows has changed, unless [force]. */
  private render(force = false): void {
    const el = this.elements;
    if (!el) return;
    const page = this.page();
    const key = `${page.step}|${page.title}|${page.hint}|${page.a}|${page.b}|${this.opened}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const text = (value: string) => panelText(value);
    el.step.setProperties({ text: text(page.step) });
    el.title.setProperties({ text: text(page.title) });
    el.hint.setProperties({ text: text(page.hint) });
    el.aLabel.setProperties({ text: text(page.a) });
    el.bLabel.setProperties({ text: text(page.b) });
    el.b.setProperties({ display: page.b ? 'flex' : 'none' });
    el.skipLabel.setProperties({ text: text(this.text().close) });
    this.view.open = this.opened;
    this.view.stage = this.pairing.view.stage;
    this.view.step = text(page.step);
    this.view.title = text(page.title);
    this.view.hint = text(page.hint);
    this.view.a = text(page.a);
    this.view.b = text(page.b);
    this.paint(page.aColor);
  }

  private paint(aColor: string = COLOR.choice): void {
    const el = this.elements;
    if (!el) return;
    const items: readonly (readonly [Key, UIKit.Text, string])[] = [['a', el.a, aColor], ['b', el.b, COLOR.choice], ['skip', el.skip, COLOR.quiet]];
    for (const [key, element, base] of items) {
      // The base colour is the button's own resting colour; hover fades it, as on the other panels.
      element.setProperties({ backgroundColor: base, borderColor: idleBorder(base) });
      hoverFades.paint(element, base, this.hovered.has(key));
    }
  }

  /** In front of the eyes and facing them, wherever the workspace's anchor is now (it moves when XR starts). */
  private place(): void {
    const anchor = workspace.state.anchor;
    const panel = this.entity?.object3D;
    if (!panel) return;
    panel.position.set(anchor.x - Math.sin(anchor.yaw) * AHEAD, anchor.y + LIFT, anchor.z - Math.cos(anchor.yaw) * AHEAD);
    panel.rotation.set(0, anchor.yaw, 0);
    panel.scale.setScalar(workspace.panelScale);
  }

  private ensurePanel(): void {
    if (this.entity) return;
    const entity = this.world.createTransformEntity(new Group());
    entity.object3D!.rotation.order = 'YXZ';
    entity.addComponent(PanelUI, { config: CONFIG });
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);
    entity.addComponent(HelperPanel);
    this.entity = entity;
  }

  private setShown(shown: boolean): void {
    this.shown = shown;
    helperState.open = shown;
    const object = this.entity?.object3D as (Object3D & { pointerEvents?: string }) | undefined;
    if (!object) return;
    object.visible = shown;
    object.pointerEvents = shown ? undefined : 'none'; // undefined: back to pointer-events' default (only listeners)
  }

  private bind(entity: Entity): void {
    const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
    if (!document || this.elements) return;
    document.setTargetDimensions(SIZE.width, SIZE.height);
    const get = (id: string) => {
      const element = document.querySelector(`#${id}`) as UIKit.Text | null;
      if (!element) throw new Error(`setup.uikitml has no #${id}`);
      element.name = `helper:${id.replace(/^setup-/, '')}`;
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
    this.cleanups.push(onSettings(() => this.paint(this.page().aColor)));
    new PanelHits(
      el.root,
      [['a', el.a], ['b', el.b], ['skip', el.skip]] as const,
      {
        click: (key) => this.choose(key),
        hover: (key, hovered) => {
          if (hovered) this.hovered.add(key);
          else this.hovered.delete(key);
          this.paint(this.page().aColor);
        },
      },
      this.cleanups,
      { name: 'helper', modal: true },
    );
    this.setShown(this.opened && !setupState.active);
    this.render(true);
    this.place();
  }
}
