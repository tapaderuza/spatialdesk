/**
 * Direct touch: push a control with a fingertip, or with the tip of a controller, with no pinch. With the space fitted
 * to the body (the working board 62 cm away, nearer after "fit to my reach"), the board is at arm's length, and pushing
 * a button is the most natural thing a hand does.
 *
 * From 5 cm in front of a panel the control under the fingertip lights, as any hover does, and a ring on the surface
 * shows where the finger will land, closing as it nears; touching the surface presses the control at once and fills
 * the ring. One press per touch: the finger must come from the front (seen 2 cm out), so a hand moving behind or along
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
import { createSystem, Mesh, PlaneGeometry, ShaderMaterial, Vector3, VisibilityState } from '@iwsdk/core';
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
}

export class PokeSystem extends createSystem({}) {
  private readonly tip = new Vector3();
  private readonly point = new Vector3();
  private readonly normal = new Vector3();
  private fingers!: Finger[];
  /** Read by the Playwright tests. */
  readonly state = { presses: 0, keys: [null, null] as (string | null)[], distances: [NaN, NaN], ready: [false, false], log: [] as string[] };

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
      return { panel: null, key: null, ready: false, ring, material, pressedAt: -Infinity };
    });
    // IWSDK's own touch pointers start enabled: off, so one touch is one press (PanelHits also ignores their events).
    this.input.xr.multiPointers.left.toggleSubPointer('touch', false);
    this.input.xr.multiPointers.right.toggleSubPointer('touch', false);
    (window as unknown as { __poke: PokeSystem['state'] }).__poke = this.state;
  }

  update(): void {
    const xr = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    for (let h = 0; h < 2; h++) {
      const finger = this.fingers[h];
      const hand = HANDS[h];
      if (!xr || !(this.input.xr.isPrimary('hand', hand) || this.input.xr.isPrimary('controller', hand))) {
        this.leave(finger, h);
        continue;
      }
      // The index fingertip with hands; with a controller, the tip of its ray (IWSDK keeps both in indexTipSpaces).
      this.world.player.indexTipSpaces[hand].getWorldPosition(this.tip);
      let best: GazeTarget | null = null;
      let distance = NaN;
      for (let i = 0; i < livePanels.length; i++) {
        const d = livePanels[i].touchDistance(this.tip, MARGIN, NEAR, BEHIND);
        if (Number.isNaN(d)) continue; // not over this panel, or not near it
        if (best === null || Math.abs(d) < Math.abs(distance)) {
          best = livePanels[i];
          distance = d;
        }
      }
      if (!best) {
        this.leave(finger, h);
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
