/**
 * Fit to my reach (src/accessibility/reach.ts) in the app. "Fit to my reach" (or "a mi alcance") starts it in XR: an
 * amber dot rides on each hand, the console asks her to reach out to where it is comfortable and pinch, and that
 * pinch (or trigger) is measured instead of pressing what its ray points at. The result is a proposal on the agent's
 * card, with what was measured in words; nothing moves until Apply, and Undo takes it back like any other change.
 */
import { createSystem, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, VisibilityState, type Entity } from '@iwsdk/core';
import { AgentSystem } from '../agent/agent-system.js';
import type { AgentPlan } from '../agent/client.js';
import { play } from '../ui/sounds.js';
import { workspace } from '../workspace/store.js';
import { comfortFromReach, reachState, type Reach } from './reach.js';

/** Unanswered, the measurement ends on its own, so a pinch much later is a pinch again. */
const TIMEOUT_MS = 30_000;
const DOT_RADIUS = 0.015;

const spanish = () => (new URLSearchParams(location.search).get('lang') || navigator.language).startsWith('es');

export class ReachSystem extends createSystem({}) {
  private dots!: [Entity, Entity];
  private session: XRSession | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private readonly hand = new Vector3();
  /** Read by the Playwright tests: the last measurement, or why there was none. */
  readonly view = { measuring: false, last: null as Reach | null, refused: '' };

  init(): void {
    const material = new MeshBasicMaterial({ color: '#ffb020', depthTest: false, depthWrite: false, toneMapped: false });
    const geometry = new SphereGeometry(DOT_RADIUS, 16, 12);
    const dot = (name: string) => {
      const mesh = new Mesh(geometry, material);
      mesh.name = name;
      mesh.renderOrder = 999;
      mesh.visible = false;
      return this.world.createTransformEntity(mesh);
    };
    this.dots = [dot('reach-dot-left'), dot('reach-dot-right')];
    (window as unknown as { __reach: ReachSystem }).__reach = this;
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(() => this.bindSession()), () => this.cancel());
  }

  update(): void {
    if (!reachState.measuring) return;
    this.follow(0, this.player.gripSpaces.left);
    this.follow(1, this.player.gripSpaces.right);
  }

  /** Starts measuring; only in XR, where there are hands to measure. */
  start(): void {
    const es = spanish();
    if (!this.session) {
      this.view.refused = 'not-immersive';
      workspace.notify({ text: es ? 'Entra en VR para medir tu alcance con la mano.' : 'Enter VR to measure your reach with your hand.', error: true });
      return;
    }
    this.world.getSystem(AgentSystem)?.dismiss();
    this.setMeasuring(true);
    this.view.refused = '';
    play('listen');
    workspace.notify({ text: es
      ? 'Estira la mano hasta donde te resulte cómodo y pellizca. Ahí irá tu tablero.'
      : 'Reach out to where your hand is comfortable, and pinch. Your board will go there.', error: false });
  }

  /** True when a measurement was waiting (so "cancel" had something to cancel). */
  cancel(): boolean {
    if (!reachState.measuring) return false;
    this.setMeasuring(false);
    return true;
  }

  private setMeasuring(on: boolean): void {
    reachState.measuring = on;
    this.view.measuring = on;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = on ? setTimeout(() => this.cancel(), TIMEOUT_MS) : null;
    if (!on) for (const dot of this.dots) dot.object3D!.visible = false;
  }

  private follow(i: 0 | 1, grip: { getWorldPosition(v: Vector3): Vector3 } | undefined): void {
    const dot = this.dots[i].object3D!;
    if (!grip) {
      dot.visible = false;
      return;
    }
    grip.getWorldPosition(dot.position);
    dot.visible = true;
  }

  /** In XR the measuring pinch arrives here; the panels ignore it meanwhile (reachState). */
  private bindSession(): void {
    const session = this.world.visibilityState.peek() === VisibilityState.NonImmersive ? null : (this.world.session ?? null);
    if (session === this.session) return;
    this.session?.removeEventListener('selectstart', this.select);
    this.session = session;
    session?.addEventListener('selectstart', this.select);
    if (!session) this.cancel();
  }

  private readonly select = (event: XRInputSourceEvent): void => {
    if (!reachState.measuring) return;
    const grip = event.inputSource.handedness === 'left' ? this.player.gripSpaces.left : this.player.gripSpaces.right;
    if (!grip) return;
    grip.getWorldPosition(this.hand);
    const reach = comfortFromReach(workspace.state.anchor, this.hand);
    const es = spanish();
    if (!reach) {
      play('error');
      workspace.notify({ text: es ? 'Estira la mano un poco más lejos y pellizca.' : 'Reach a little further out, then pinch.', error: true });
      return;
    }
    this.view.last = reach;
    play('pick');
    this.world.getSystem(AgentSystem)?.previewLocalPlan(this.proposal(reach, es));
    // Measuring ends a moment after this pinch is over: the panels see its release a frame or two later, and it must
    // not press the card that just opened under the ray.
    this.session?.addEventListener('selectend', () => setTimeout(() => this.setMeasuring(false), 300), { once: true });
  };

  private proposal(reach: Reach, es: boolean): AgentPlan {
    const before = workspace.state.comfort;
    const c = reach.comfort;
    const cm = Math.round(c.reach * 62);
    const up = Math.abs(c.tiltDeg);
    const steps: AgentPlan['steps'] = [];
    if (before.reach !== c.reach) steps.push({ op: { op: 'set_comfort', reach: c.reach }, why: es ? `Donde llegó tu mano: a ${cm} cm` : `Where your hand reached: ${cm} cm away` });
    if (before.tiltDeg !== c.tiltDeg) {
      steps.push({ op: { op: 'set_comfort', tiltDeg: c.tiltDeg }, why: es
        ? c.tiltDeg >= 0 ? `${up} grados más arriba, a la altura de tu mano` : `${up} grados más abajo, a la altura de tu mano`
        : c.tiltDeg >= 0 ? `${up} degrees higher, at your hand's height` : `${up} degrees lower, at your hand's height` });
    }
    if (before.side !== c.side) {
      steps.push({ op: { op: 'set_comfort', side: c.side }, why: es
        ? c.side === 'both' ? 'Centrado, donde estiraste la mano' : `Hacia tu ${c.side === 'right' ? 'derecha' : 'izquierda'}, donde estiraste la mano`
        : c.side === 'both' ? 'Centred, where you reached' : `Toward your ${c.side}, where you reached` });
    }
    return {
      ok: true,
      source: 'reach',
      steps,
      summary: steps.length
        ? es ? 'Medido con tu mano. Revisa los cambios antes de aplicarlos.' : 'Measured with your hand. Review the changes before applying.'
        : es ? 'Tu espacio ya está a tu alcance.' : 'Your space is already within your reach.',
    };
  }
}
