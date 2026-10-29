/**
 * Direct touch: push a control with a fingertip, or with the tip of a controller, with no pinch. With the space fitted
 * to the body (the working board 62 cm away, nearer after "fit to my reach"), the board is at arm's length, and pushing
 * a button is the most natural thing a hand does.
 *
 * From 5 cm in front of a panel the control under the fingertip lights, as any hover does, and a ring on the surface
 * shows where the finger will land, closing as it nears; the control itself gives way, a few millimetres back into its
 * panel as the finger comes and then with the finger, and springs back after ([PRE_SINK]). Touching the surface presses
 * the control at once and fills the ring. One press per touch: the finger must come from the front (seen 2 cm out), so a hand moving behind or along
 * a panel never presses it, and must draw back 2 cm before it can press again.
 *
 * Pressed on contact, with no time limit, so a slow or unsteady press counts. IWSDK's own poke (its TouchPointer, for
 * PokeInteractable) presses only if the finger leaves again within 800 ms, which a careful hand, or one with a tremor,
 * often does not: so no panel is PokeInteractable, IWSDK's touch pointers are switched off (they are on by default, and
 * a quick touch then pressed twice: here on contact, there on release), and this owns direct touch. Like a pinch, it
 * presses nothing while a panel glides (src/ui/glide.ts), in switch mode, or while a reach is measured.
 *
 * Every frame in XR, for each hand: three dot products per panel, no matrix inverse, no allocation.
 */
import { createSystem, InputComponent, Mesh, PlaneGeometry, ShaderMaterial, Vector3, VisibilityState } from '@iwsdk/core';
import { livePanels, type GazeTarget } from './panel-hits.js';
import { accessPreferences } from '../accessibility/preferences.js';
import { reachState } from '../accessibility/reach.js';

/** The control lights, and the ring appears, from this far in front. */
const NEAR = 0.05;
/** The fingertip joint sits a few millimetres inside the skin: this close is touching. */
const CONTACT = 0.006;
/** A finger pushed through the panel is still touching it, this far. */
const BEHIND = 0.03;
/** Seen this far out, the finger is ready to press (an approach, or a draw-back after a press). */
const ARM = 0.02;
/** Over the panel, give or take this much at its edges. */
const MARGIN = 0.01;
/**
 * A fingertip this close to a panel's nearest point (in front, behind or past an edge) is about to poke: its ray
 * steps aside, and comes back past [RAY_BACK]. IWSDK's own thresholds for its poke's priority over the ray. Never while
 * the trigger is held, so a drag with the ray is never cut.
 */
const RAY_OFF = 0.15;
const RAY_BACK = 0.2;
/**
 * The control under the fingertip gives way, as a real key does: back into its panel in proportion to the finger's
 * nearness, from nothing at [NEAR] to [PRE_SINK] on contact, then with the finger, up to [MAX_SINK]. When the finger
 * leaves, it springs back in about a tenth of a second. Applied in steps of [SINK_STEP], so UIKit restyles it only when
 * the change can be seen.
 */
const PRE_SINK = 0.0025;
const MAX_SINK = 0.012;
const SINK_STEP = 0.00025;
const SPRING_BACK_S = 0.035;
const RING_FAR = 0.028;
const RING_NEAR = 0.012;
/** In front of the surface, never inside it. */
const RING_LIFT = 0.002;
const PRESS_FLASH_MS = 300;
const HANDS = ['left', 'right'] as const;

// A dark rim and a white ring (visible on any panel colour), firmer as the finger nears; the accent fills it on a press.
const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAGMENT = /* glsl */ `
uniform float near;
uniform float pressed;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  if (r > 1.0) discard;
  vec4 color = vec4(0.0);
  if (r > 0.78) color = vec4(0.06, 0.07, 0.09, 0.85);
  else if (r > 0.56) color = vec4(0.97, 0.98, 1.0, 0.55 + 0.45 * near);
  else if (pressed > 0.0) color = vec4(0.61, 0.76, 1.0, pressed);
  if (color.a == 0.0) discard;
  gl_FragColor = color;
}`;

interface Finger {
  panel: GazeTarget | null;
  key: string | null;
  /** Seen [ARM] out in front since the last touch: touching now presses. */
  ready: boolean;
  ring: Mesh;
  material: ShaderMaterial;
  pressedAt: number;
  /** This hand's ray is switched off while it pokes ([RAY_OFF]). */
  rayOff: boolean;
  /** The control giving way under this finger (kept while it springs back), how far in it is, and as last applied. */
  sinkPanel: GazeTarget | null;
  sinkKey: string | null;
  sink: number;
  sunk: number;
}

/** How far a control is in with the fingertip [distance] in front of its panel (negative: pushed through). */
function sinkFor(distance: number): number {
  if (distance >= NEAR) return 0;
  if (distance > CONTACT) return (PRE_SINK * (NEAR - distance)) / (NEAR - CONTACT);
  return Math.min(MAX_SINK, PRE_SINK + CONTACT - distance);
}

export class PokeSystem extends createSystem({}) {
  private readonly tip = new Vector3();
  private readonly point = new Vector3();
  private readonly normal = new Vector3();
  private fingers!: Finger[];
  /** Read by the Playwright tests. */
  readonly state = { presses: 0, keys: [null, null] as (string | null)[], distances: [NaN, NaN], ready: [false, false], rayOff: [false, false], depths: [0, 0], log: [] as string[] };

  init(): void {
    this.fingers = HANDS.map((hand) => {
      const material = new ShaderMaterial({
        uniforms: { near: { value: 0 }, pressed: { value: 0 } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const ring = new Mesh(new PlaneGeometry(1, 1), material);
      ring.name = `poke-ring-${hand}`;
      ring.renderOrder = 1000; // over the panel it marks
      ring.visible = false;
      this.world.createTransformEntity(ring);
      return { panel: null, key: null, ready: false, ring, material, pressedAt: -Infinity, rayOff: false, sinkPanel: null, sinkKey: null, sink: 0, sunk: 0 };
    });
    // IWSDK's own touch pointers start enabled: off, so one touch is one press (PanelHits also ignores their events).
    this.input.xr.multiPointers.left.toggleSubPointer('touch', false);
    this.input.xr.multiPointers.right.toggleSubPointer('touch', false);
    (window as unknown as { __poke: PokeSystem['state'] }).__poke = this.state;
  }

  update(delta: number): void {
    const xr = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const dt = Math.min(0.1, delta);
    for (let h = 0; h < 2; h++) {
      const finger = this.fingers[h];
      const hand = HANDS[h];
      if (!xr || !(this.input.xr.isPrimary('hand', hand) || this.input.xr.isPrimary('controller', hand))) {
        this.setRay(finger, h, false);
        this.leave(finger, h);
        this.sinkTo(finger, h, null, null, 0, dt);
        continue;
      }
      // The index fingertip with hands; with a controller, the tip of its ray (IWSDK keeps both in indexTipSpaces).
      this.world.player.indexTipSpaces[hand].getWorldPosition(this.tip);
      let best: GazeTarget | null = null;
      let distance = NaN;
      let nearest = Infinity;
      for (let i = 0; i < livePanels.length; i++) {
        const d = livePanels[i].touchDistance(this.tip, RAY_BACK, RAY_BACK, RAY_BACK);
        if (Number.isNaN(d)) continue; // nowhere near this panel
        nearest = Math.min(nearest, livePanels[i].touchGap());
        if (d <= NEAR && d >= -BEHIND && livePanels[i].touchOver(MARGIN) && (best === null || Math.abs(d) < Math.abs(distance))) {
          best = livePanels[i];
          distance = d;
        }
      }
      this.setRay(finger, h, nearest < (finger.rayOff ? RAY_BACK : RAY_OFF));
      if (!best) {
        this.leave(finger, h);
        this.sinkTo(finger, h, null, null, 0, dt);
        continue;
      }
      best.touchDistance(this.tip, MARGIN, NEAR, BEHIND); // [best] remembers this tip, whichever panel was measured last
      const fresh = best !== finger.panel;
      if (fresh) {
        finger.panel?.setPokeHover(h as 0 | 1, null);
        finger.panel = best;
        finger.key = null;
        finger.ready = false; // arriving from the side or from behind is not an approach
      }
      const key = best.pokeHit(fresh);
      if (key !== finger.key) {
        best.setPokeHover(h as 0 | 1, key);
        finger.key = key;
      }
      this.sinkTo(finger, h, best, key, key == null ? 0 : sinkFor(distance), dt);
      if (distance > ARM) finger.ready = true;
      else if (distance <= CONTACT && finger.ready) {
        finger.ready = false; // one press per touch, wherever on the panel it lands
        if (key != null && !accessPreferences.switchEnabled && !reachState.measuring) {
          finger.pressedAt = performance.now();
          this.state.presses++;
          this.state.log.push(`${hand} ${best.name || 'panel'}:${key}`);
          if (this.state.log.length > 8) this.state.log.shift();
          best.press(key);
        }
      }
      this.state.keys[h] = key;
      this.state.distances[h] = distance;
      this.state.ready[h] = finger.ready;
      this.placeRing(finger, best, distance);
    }
  }

  /** The ring where the finger will land: smaller and firmer as it nears, filled for a moment after a press. */
  private placeRing(finger: Finger, panel: GazeTarget, distance: number): void {
    panel.touchFace(this.point, this.normal);
    const ring = finger.ring;
    ring.position.copy(this.point).addScaledVector(this.normal, RING_LIFT);
    ring.lookAt(this.point.addScaledVector(this.normal, 1));
    const t = Math.min(1, Math.max(0, (distance - CONTACT) / (NEAR - CONTACT)));
    ring.scale.setScalar(RING_NEAR + (RING_FAR - RING_NEAR) * t);
    finger.material.uniforms.near.value = 1 - t;
    finger.material.uniforms.pressed.value = Math.max(0, 1 - (performance.now() - finger.pressedAt) / PRESS_FLASH_MS);
    ring.visible = true;
  }

  /**
   * Moves the control under a finger toward [target] metres in: in with the finger at once, out on a quick spring. A
   * finger that slides onto another control lets the one before come straight back up.
   */
  private sinkTo(finger: Finger, h: number, panel: GazeTarget | null, key: string | null, target: number, dt: number): void {
    if (panel && key != null && (panel !== finger.sinkPanel || key !== finger.sinkKey)) {
      if (finger.sinkPanel && finger.sinkKey != null && finger.sunk !== 0) finger.sinkPanel.setPokeDepth(finger.sinkKey, 0);
      finger.sinkPanel = panel;
      finger.sinkKey = key;
      finger.sink = 0;
      finger.sunk = 0;
    }
    if (!finger.sinkPanel || finger.sinkKey == null) return;
    finger.sink = target >= finger.sink ? target : target + (finger.sink - target) * Math.exp(-dt / SPRING_BACK_S);
    const applied = Math.round(finger.sink / SINK_STEP) * SINK_STEP;
    if (applied !== finger.sunk) {
      finger.sunk = applied;
      finger.sinkPanel.setPokeDepth(finger.sinkKey, applied);
    }
    this.state.depths[h] = applied;
    if (applied === 0 && key == null) {
      finger.sinkPanel = null; // back in its place: nothing more to move
      finger.sinkKey = null;
    }
  }

  /** Switches a hand's ray off while it is about to poke, and back on after; never in the middle of a pull. */
  private setRay(finger: Finger, h: number, off: boolean): void {
    if (finger.rayOff === off) return;
    if (off && this.input.xr.gamepads[HANDS[h]]?.getButtonPressed(InputComponent.Trigger)) return;
    finger.rayOff = off;
    this.state.rayOff[h] = off;
    this.input.xr.multiPointers[HANDS[h]].toggleSubPointer('ray', !off);
  }

  /** Nothing within reach of the fingertip: no highlight, no ring (the ray is setRay's business). */
  private leave(finger: Finger, h: number): void {
    if (finger.panel) finger.panel.setPokeHover(h as 0 | 1, null);
    finger.panel = null;
    finger.key = null;
    finger.ready = false;
    finger.ring.visible = false;
    this.state.keys[h] = null;
    this.state.distances[h] = NaN;
    this.state.ready[h] = false;
  }
}
