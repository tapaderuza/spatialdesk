/**
 * Hands-free: look at a control and keep looking to press it. A small ring sits at the centre of the view on any
 * panel and fills while the gaze rests on one control (1 s for buttons, 1.6 s for cards and the notice line, which
 * are also read); when it is full, the control is pressed exactly as a tap presses it.
 *
 * Two rules keep reading from pressing things (the "Midas touch"):
 *  - a control just pressed is not pressed again until the gaze has left it;
 *  - after a press nothing is pressed until the gaze has moved a little, so a panel that closes under a still gaze
 *    never presses whatever was behind it.
 *
 * The eyes where the headset tracks them (Meta VR Glasses: IWSDK's gaze pose, the same ray its look-and-pinch uses),
 * so the whole workspace works with the eyes alone; elsewhere the head, which every Quest user can aim.
 * Only while hands-free is on and in XR: every third frame one plane test per panel and one rectangle test per control
 * on the panel looked at; every frame the ring follows the gaze. No allocation per frame.
 */
import { createSystem, Mesh, PlaneGeometry, ShaderMaterial, Vector3, VisibilityState, type Entity } from '@iwsdk/core';
import { livePanels, type GazeTarget } from './panel-hits.js';
import { settings } from './settings.js';
import { accessPreferences, onAccessPreferences } from '../accessibility/preferences.js';
/** After a press, the head turns at least this much before anything else can be pressed. */
const REARM_COS = Math.cos((3 * Math.PI) / 180);
const RETICLE_SIZE = 0.036; // 3.6 cm: about 3.4 degrees at arm's length, the fill readable at a glance
const SURFACE_OFFSET = 0.004; // in front of the panel, never inside it
/** Ray tests every third frame: about 40 ms at 72 Hz, nothing next to a one-second dwell. */
const TEST_EVERY_FRAMES = 3;

/** Controls that are also read (cards, columns, the notice line) wait longer than buttons. */
function dwellFor(key: string): number {
  return key === 'notice' || key === 'board' || key.startsWith('card-') || key.startsWith('col-') ? accessPreferences.readDwellMs : accessPreferences.dwellMs;
}

// A dark rim and a white ring (visible on any panel colour), the fill as a clockwise arc from 12 o'clock, a centre dot.
const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAGMENT = /* glsl */ `
uniform float progress;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float turn = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
  vec4 color = vec4(0.0);
  if (r > 0.86) color = vec4(0.06, 0.07, 0.09, 0.9);
  else if (r > 0.68) color = vec4(0.97, 0.98, 1.0, 1.0);
  else if (r > 0.3 && progress > 0.0 && turn <= progress) color = vec4(0.61, 0.76, 1.0, 1.0);
  else if (r < 0.14) color = vec4(0.97, 0.98, 1.0, 1.0);
  if (color.a == 0.0) discard;
  gl_FragColor = color;
}`;

export class GazeSystem extends createSystem({}) {
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly point = new Vector3();
  private readonly pressedFrom = new Vector3();
  private reticle!: Entity;
  private material!: ShaderMaterial;
  private panel: GazeTarget | null = null;
  private key: string | null = null;
  private distance = 0;
  private since = 0;
  private frame = 0;
  /** The control pressed last, until the gaze leaves it. */
  private spentPanel: GazeTarget | null = null;
  private spentKey: string | null = null;
  private lostAt = -1;
  private onTarget = false;
  /** True from a press until the head has moved [REARM_COS] away from where it was. */
  private settling = false;
  /** Read by the Playwright tests. */
  readonly state = { key: null as string | null, progress: 0, presses: 0, source: 'head' as 'eyes' | 'head' };

  init(): void {
    this.material = new ShaderMaterial({
      uniforms: { progress: { value: 0 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(new PlaneGeometry(RETICLE_SIZE, RETICLE_SIZE), this.material);
    mesh.name = 'gaze-reticle';
    mesh.renderOrder = 1000; // drawn over the panel it rests on
    mesh.visible = false;
    this.reticle = this.world.createTransformEntity(mesh);
    (window as unknown as { __gaze: GazeSystem['state'] }).__gaze = this.state;
    this.cleanupFuncs.push(onAccessPreferences(() => { this.since = performance.now(); this.lostAt = -1; }));
  }

  update(): void {
    const reticle = this.reticle.object3D!;
    if (!settings.handsFree || this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      if (reticle.visible || this.panel) this.leave(reticle);
      return;
    }
    // The eyes when the headset tracks them (IWSDK's gaze pose; a target ray points down its -Z), else the head.
    const player = this.world.player;
    const eyes = player.gazeOrigin === 'tracked';
    if (eyes) {
      player.eyeSpace.getWorldPosition(this.origin);
      player.eyeSpace.getWorldDirection(this.direction).negate();
    } else {
      this.world.camera.getWorldPosition(this.origin);
      this.world.camera.getWorldDirection(this.direction);
    }
    this.state.source = eyes ? 'eyes' : 'head';
    if (this.settling && this.direction.dot(this.pressedFrom) < REARM_COS) this.settling = false;

    // The ray tests (one plane per panel, then the controls of the one looked at) run every few frames; the ring
    // follows the head every frame along the last distance found.
    const testing = ++this.frame % TEST_EVERY_FRAMES === 0 || !this.panel;
    if (testing && !this.test()) {
      this.leave(reticle);
      return;
    }
    const panel = this.panel!;
    const key = this.key;
    reticle.position.copy(this.direction).multiplyScalar(this.distance - SURFACE_OFFSET).add(this.origin);
    reticle.lookAt(this.origin);
    reticle.visible = true;

    let progress = 0;
    if (key != null && !this.spentPanel && !this.settling) {
      const now = this.lostAt >= 0 ? this.lostAt : performance.now();
      progress = Math.max(0, (now - this.since - accessPreferences.settleMs) / dwellFor(key));
      if (progress >= 1 && testing && this.onTarget) {
        // Pressed only right after a test, so never on a control the gaze has just left.
        progress = 0;
        this.spentPanel = panel;
        this.spentKey = key;
        this.settling = true;
        this.pressedFrom.copy(this.direction);
        this.state.presses++;
        panel.press(key);
      }
    }
    this.material.uniforms.progress.value = Math.min(progress, 1);
    this.state.key = key;
    this.state.progress = progress;
  }

  /** Finds the nearest panel and the control under the gaze; false when the gaze is on no panel. */
  private test(): boolean {
    let best: GazeTarget | null = null;
    let distance = Infinity;
    for (let i = 0; i < livePanels.length; i++) {
      const t = livePanels[i].rayDistance(this.origin, this.direction);
      if (t > 0 && t < distance) {
        distance = t;
        best = livePanels[i];
      }
    }
    const now = performance.now();
    if (!best) return this.holdTarget(now);
    this.distance = distance;
    this.point.copy(this.direction).multiplyScalar(distance).add(this.origin);
    const key = best.gazeHit(this.point, best !== this.panel);
    if (best === this.panel && key == null && this.holdTarget(now)) return true;
    if (best !== this.panel || key !== this.key) {
      if (this.panel !== best) this.panel?.setGazeHover(null);
      best.setGazeHover(key);
      this.panel = best;
      this.key = key;
      this.since = now;
      if (this.spentPanel && (this.spentPanel !== best || this.spentKey !== key)) {
        this.spentPanel = null;
        this.spentKey = null;
      }
    } else if (this.lostAt >= 0) {
      this.since += now - this.lostAt; // do not count time away from the control toward a selection
    }
    this.lostAt = -1;
    this.onTarget = key != null;
    return true;
  }

  /** Brief tracking misses may freeze progress; no selection can occur until the same visible control is hit again. */
  private holdTarget(now: number): boolean {
    if (!accessPreferences.tremorTolerance || accessPreferences.targetGraceMs === 0 || !this.panel || this.key == null || livePanels.indexOf(this.panel) < 0) return false;
    if (this.lostAt < 0) this.lostAt = now;
    this.onTarget = false;
    return now - this.lostAt <= accessPreferences.targetGraceMs;
  }

  private leave(reticle: { visible: boolean }): void {
    reticle.visible = false;
    this.panel?.setGazeHover(null);
    this.panel = null;
    this.key = null;
    this.spentPanel = null;
    this.spentKey = null;
    this.lostAt = -1;
    this.onTarget = false;
    this.material.uniforms.progress.value = 0;
    this.state.key = null;
    this.state.progress = 0;
  }
}
