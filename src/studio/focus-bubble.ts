/**
 * The focus bubble: while a focus block runs, everything beyond arm's reach fades and the board you work on stays
 * clear. In your room the real room recedes and your real desk stays; in VR night falls over the hills. When the
 * block ends, pauses or turns into a break, the world comes back. Fewer things in view to pull the attention away,
 * which is what a wandering mind needs, and passthrough that changes with the work instead of a backdrop.
 *
 * In the room, a sphere round the head, drawn after the opaque scene and before the panels, darkens what lies beyond
 * its radius except a cone toward the focus board. The sphere has a hole where that cone is clear, its pole turned
 * toward the board, so while you look at your work the GPU fills only the edges of the view. In VR there is nothing to
 * overlay: the sky and the hills themselves dim (the dome's intensity, the horizon's colour), which costs no fill at
 * all; measured in the perf gate, an overlay there cost 1.5 ms per frame (p50) on the reference laptop. The panels,
 * the desk and the plant are never dimmed. The strength eases in over a few seconds and out faster. Off with the
 * "Focus dimming" setting ("dimming off" by voice).
 */
import {
  BackSide,
  Color,
  createSystem,
  DomeGradient,
  LevelRoot,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  VisibilityState,
  type Entity,
  type MeshBasicMaterial,
} from '@iwsdk/core';
import { onSettings, settings } from '../ui/settings.js';
import { inRoom } from '../room/room-system.js';
import { workspace } from '../workspace/store.js';

/** Inside this radius (metres) nothing fades: the board, timers, desk, plant, companion and console. */
const RADIUS = 1.25;
/** Half-angle of the clear view toward the board, and the soft edge beyond it (degrees). */
const CLEAR_DEG = 32;
const SOFT_DEG = 12;
/** How dark the faded part gets: the real room a little more than the studio, which is already dusk. */
const STRENGTH = { room: 0.62, studio: 0.5 } as const;
const IN_S = 2.5;
const OUT_S = 1.2;
const BREAK = /^\s*break\s*$/i;

/** The sphere's pole (+Y in its own frame) points at the board: the clear cone is round it. */
const POLE = new Vector3(0, 1, 0);

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform float uStrength;
uniform float uClearCos;
uniform float uSoftCos;
uniform vec3 uColor;
varying vec3 vDir;
void main() {
  float clear = smoothstep(uSoftCos, uClearCos, normalize(vDir).y);
  gl_FragColor = vec4(uColor, uStrength * (1.0 - clear));
}`;

export class FocusBubbleSystem extends createSystem({ domes: { required: [DomeGradient, LevelRoot] } }) {
  private entity!: Entity;
  private material!: ShaderMaterial;
  private readonly eye = new Vector3();
  private readonly toBoard = new Vector3();
  /** The horizon's materials (VR), dimmed by scaling their colour: the vertex colours carry the light. */
  private horizon: MeshBasicMaterial[] = [];
  private dome: Entity | null = null;
  private domeIntensity = 1;
  /** How dim the VR scene is now, so the dome and horizon are written only while that changes. */
  private sceneDim = 0;
  private strength = 0;
  /** Read by the Playwright tests: the overlay is drawn only in the room; in VR the scene keeps [sceneLight] of its light. */
  readonly view = { strength: 0, active: false, overlay: false, sceneLight: 1 };

  init(): void {
    this.material = new ShaderMaterial({
      uniforms: {
        uStrength: { value: 0 },
        uClearCos: { value: Math.cos((CLEAR_DEG * Math.PI) / 180) },
        uSoftCos: { value: Math.cos(((CLEAR_DEG + SOFT_DEG) * Math.PI) / 180) },
        uColor: { value: new Color('#04060b') },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: BackSide,
    });
    // From the edge of the clear cone (nothing to draw inside it) to the far pole; rings fine enough for the soft edge.
    const hole = (CLEAR_DEG * Math.PI) / 180;
    const mesh = new Mesh(new SphereGeometry(RADIUS, 32, 20, 0, Math.PI * 2, hole, Math.PI - hole), this.material);
    mesh.name = 'focus-bubble';
    mesh.renderOrder = -1; // before the panels: they are never dimmed, whatever their distance
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.entity = this.world.createTransformEntity(mesh);
    this.world.getSceneObject('studio-horizon')?.traverse((o) => {
      if ((o as Mesh).isMesh) this.horizon.push((o as Mesh).material as MeshBasicMaterial);
    });
    const useDome = (dome: Entity) => {
      this.dome = dome;
      this.domeIntensity = dome.getValue(DomeGradient, 'intensity') ?? 1;
    };
    for (const dome of this.queries.domes.entities) useDome(dome); // the level root loaded before this system
    this.queries.domes.subscribe('qualify', useDome);
    (window as unknown as { __bubble: FocusBubbleSystem }).__bubble = this;
    this.cleanupFuncs.push(onSettings(() => (this.view.active = this.wanted())));
  }

  update(delta: number): void {
    const active = this.wanted();
    this.view.active = active;
    if (!active && this.strength === 0 && this.sceneDim === 0) return;
    const room = inRoom(this.world);
    const target = active ? (room ? STRENGTH.room : STRENGTH.studio) : 0;
    const rate = (active ? 1 / IN_S : 1 / OUT_S) * delta;
    this.strength = this.strength < target ? Math.min(target, this.strength + rate) : Math.max(target, this.strength - rate);
    this.view.strength = this.strength;
    this.dimScene(room ? 0 : this.strength);
    const mesh = this.entity.object3D!;
    mesh.visible = room && this.strength > 0;
    this.view.overlay = mesh.visible;
    if (!mesh.visible) return;
    // Centred on the eyes, clear toward the focus board wherever it stands.
    this.world.camera.getWorldPosition(this.eye);
    mesh.position.copy(this.eye);
    const ws = workspace.state;
    const boards = ws.boards;
    for (let i = 0; i < boards.length; i++) {
      if (boards[i].id !== ws.focusBoardId) continue;
      const p = boards[i].pose;
      this.toBoard.set(p.x - this.eye.x, p.y - this.eye.y, p.z - this.eye.z).normalize();
      mesh.quaternion.setFromUnitVectors(POLE, this.toBoard);
    }
    this.material.uniforms.uStrength.value = this.strength;
  }

  /** VR: the sky and the hills at (1 - dim) of their light; written only when the dimness changes. */
  private dimScene(dim: number): void {
    if (dim === this.sceneDim) return;
    this.sceneDim = dim;
    const light = 1 - dim;
    this.view.sceneLight = light;
    for (let i = 0; i < this.horizon.length; i++) this.horizon[i].color.setScalar(light);
    if (this.dome) {
      this.dome.setValue(DomeGradient, 'intensity', this.domeIntensity * light);
      this.dome.setValue(DomeGradient, '_needsUpdate', true);
    }
  }

  /** In XR, with the setting on, while a focus block (not a break) runs. */
  private wanted(): boolean {
    if (!settings.focusDim || this.world.visibilityState.peek() === VisibilityState.NonImmersive) return false;
    const timers = workspace.state.timers;
    for (let i = 0; i < timers.length; i++) {
      if (timers[i].state === 'running' && !BREAK.test(timers[i].label)) return true;
    }
    return false;
  }
}
