/**
 * A soft rim of light round the card a pointer rests on: at once under a ray (a controller's, or a hand's for a distant
 * pinch, or the mouse), and under the eyes once they have rested on it for a second, when it is "this" for the agent
 * (src/ui/attention.ts). The rim breathes slowly and never blinks; with reduced motion it holds still.
 *
 * It lies outside the card's edge with only a hairline on the edge itself, so the centre the eyes aim at is left as it
 * is: the card's own hover lightens and lifts it (src/ui/hover.ts), and Meta's eye guidance keeps outlines off the
 * target. The light is the hover accent, the blue a hovered control lifts toward.
 *
 * One mesh for the whole app, shown only while a card is lit (one draw call per eye), placed on the card every frame
 * from the panel's own matrix (it rises with the card), its rounded shape measured in the shader. Nothing per frame
 * while hidden, no allocation while shown.
 */
import { createSystem, Matrix4, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from '@iwsdk/core';
import type { GazeTarget } from './panel-hits.js';
import { hoverTick } from './sounds.js';
import { accessPreferences } from '../accessibility/preferences.js';

/** Fades on and off like a hover (src/ui/hover.ts). */
const ON_MS = 300;
const OFF_MS = 400;
/** One slow breath: under half a hertz, far from any flicker. */
const BREATH_MS = 2600;
const PEAK = 0.8;
/** The breath dims the rim to this share of its peak, never out. */
const LOW = 0.55;
/** In proportion to the card's height (board.uikitml .card: 6.4 high, corners 1.2): the glow, the hairline, the corners. */
const GLOW_OF_HEIGHT = 0.18;
const LINE_OF_HEIGHT = 0.022;
const RADIUS_OF_HEIGHT = 1.2 / 6.4;
/** In front of the card, never inside it. */
const LIFT = 0.0015;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// The distance to the card's rounded edge: a hairline on it, and outside a glow that fades out over [glow].
const FRAGMENT = /* glsl */ `
uniform vec2 size;
uniform vec2 extent;
uniform float radius;
uniform float glow;
uniform float line;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec2 q = abs((vUv - 0.5) * size) - extent + radius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float edge = 1.0 - smoothstep(0.0, line, abs(d));
  float halo = d > 0.0 ? exp(-3.0 * d / glow) * 0.55 : 0.0;
  float a = opacity * max(edge * 0.9, halo);
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.61, 0.76, 1.0, a);
}`;

interface Lit {
  panel: GazeTarget;
  key: string;
}

/** The card under each pointer (pointer-events ids: rays, grabs, the mouse), and which pointer came last. */
const pointed = new Map<number, Lit>();
let lastPointer = -1;
let underPointer: Lit | null = null;
/** The card the eyes have rested on for a second, while they still do. */
let underEyes: Lit | null = null;
/** The eyes came to rest on a new card: one hover tick from it (hands-free has already ticked as it hovered). */
let eyesTick = false;

/** A pointer is over [key] on [panel] (null: over no card there); from PanelHits, on hover changes only. */
export function rimPointer(pointerId: number, panel: GazeTarget, key: string | null): void {
  if (key != null) {
    pointed.set(pointerId, { panel, key });
    lastPointer = pointerId;
  } else if (pointed.get(pointerId)?.panel === panel) {
    pointed.delete(pointerId); // left this panel's cards (a later move onto another panel's card is not undone)
  } else {
    return;
  }
  underPointer = pointed.get(lastPointer) ?? null;
  if (!underPointer) for (const lit of pointed.values()) underPointer = lit;
}

/** The eyes rest on [key] on [panel], a card (null: on no card); from AttentionSystem, five times a second. */
export function rimGaze(panel: GazeTarget | null, key: string | null, quiet = false): void {
  if (panel && key != null) {
    if (underEyes?.panel === panel && underEyes.key === key) return;
    underEyes = { panel, key };
    eyesTick = !quiet;
  } else {
    underEyes = null;
  }
}

export class RimSystem extends createSystem({}) {
  private mesh!: Mesh;
  private material!: ShaderMaterial;
  private readonly matrix = new Matrix4();
  private readonly basis = new Matrix4();
  private readonly xAxis = new Vector3();
  private readonly yAxis = new Vector3();
  private readonly zAxis = new Vector3();
  /** The card the rim is on (kept while it fades out). */
  private on: Lit | null = null;
  private level = 0;
  private lastMs = 0;
  private breathFrom = 0;
  /** Read by the Playwright tests. */
  readonly state = { visible: false, key: null as string | null, by: null as 'pointer' | 'eyes' | null, level: 0, opacity: 0, width: 0, height: 0, eyeTicks: 0 };

  init(): void {
    this.material = new ShaderMaterial({
      uniforms: {
        size: { value: [1, 1] },
        extent: { value: [0.5, 0.5] },
        radius: { value: 0 },
        glow: { value: 0.01 },
        line: { value: 0.001 },
        opacity: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.name = 'hover-rim';
    this.mesh.renderOrder = 997; // over the panels, under the anchor flash, the scan frame and the rings
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.world.createTransformEntity(this.mesh);
    (window as unknown as { __rim: unknown }).__rim = { state: this.state };
  }

  update(): void {
    const now = performance.now();
    const dt = Math.min(100, now - this.lastMs);
    this.lastMs = now;
    const target = underPointer ?? underEyes;
    if (target && (target.panel !== this.on?.panel || target.key !== this.on.key)) {
      this.on = target;
      this.level = Math.min(this.level, 0.3); // a new card: the rim gathers again there
      this.breathFrom = now;
    }
    this.level = target ? Math.min(1, this.level + dt / ON_MS) : Math.max(0, this.level - dt / OFF_MS);
    if (this.level === 0 || !this.on || !this.on.panel.matrixOf(this.on.key, this.matrix)) {
      if (this.mesh.visible) this.hide();
      if (this.level === 0) this.on = null;
      eyesTick = false;
      return;
    }
    this.place();
    if (eyesTick && target === underEyes) {
      this.state.eyeTicks++;
      hoverTick(this.mesh.position);
    }
    eyesTick = false;
    const breath = accessPreferences.reducedMotion ? 1 : LOW + (1 - LOW) * (0.5 + 0.5 * Math.cos((2 * Math.PI * (now - this.breathFrom)) / BREATH_MS));
    const opacity = PEAK * this.level * breath;
    this.material.uniforms.opacity.value = opacity;
    this.mesh.visible = true;
    this.state.visible = true;
    this.state.key = this.on.key;
    this.state.by = target ? (target === underPointer ? 'pointer' : 'eyes') : this.state.by;
    this.state.level = this.level;
    this.state.opacity = opacity;
  }

  /** On the card: its centre, its axes, its size (the control's matrix maps the unit square onto it). */
  private place(): void {
    const e = this.matrix.elements;
    const width = this.xAxis.set(e[0], e[1], e[2]).length();
    const height = this.yAxis.set(e[4], e[5], e[6]).length();
    this.xAxis.divideScalar(width);
    this.yAxis.divideScalar(height);
    this.zAxis.crossVectors(this.xAxis, this.yAxis);
    this.mesh.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.xAxis, this.yAxis, this.zAxis));
    this.mesh.position.set(e[12], e[13], e[14]).addScaledVector(this.zAxis, LIFT);
    const glow = GLOW_OF_HEIGHT * height;
    const sizeX = width + 2 * glow;
    const sizeY = height + 2 * glow;
    this.mesh.scale.set(sizeX, sizeY, 1);
    const u = this.material.uniforms;
    (u.size.value as number[])[0] = sizeX;
    (u.size.value as number[])[1] = sizeY;
    (u.extent.value as number[])[0] = width / 2;
    (u.extent.value as number[])[1] = height / 2;
    u.radius.value = RADIUS_OF_HEIGHT * height;
    u.glow.value = glow;
    u.line.value = LINE_OF_HEIGHT * height;
    this.state.width = width;
    this.state.height = height;
  }

  private hide(): void {
    this.mesh.visible = false;
    this.state.visible = false;
    this.state.opacity = 0;
    this.state.level = this.level;
  }
}
