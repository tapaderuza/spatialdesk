/**
 * The focus bubble: while a focus block runs, everything beyond arm's reach fades and the board you work on stays
 * clear. In your room the real room recedes and your real desk stays; in VR night falls over the hills. When the
 * block ends, pauses or turns into a break, the world comes back. Fewer things in view to pull the attention away,
 * which is what a wandering mind needs, and passthrough that changes with the work instead of a backdrop.
 *
 * A sphere round the head, drawn after the opaque scene and before the panels, darkens what lies beyond its radius
 * except a cone toward the focus board. One draw call, only while it shows; the strength eases in over a few seconds
 * and out faster. Off with the "Focus dimming" setting ("dimming off" by voice).
 */
import { BackSide, Color, createSystem, Mesh, ShaderMaterial, SphereGeometry, Vector3, VisibilityState, type Entity } from '@iwsdk/core';
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

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform float uStrength;
uniform float uClearCos;
uniform float uSoftCos;
uniform vec3 uToBoard;
uniform vec3 uColor;
varying vec3 vDir;
void main() {
  float clear = smoothstep(uSoftCos, uClearCos, dot(normalize(vDir), uToBoard));
  gl_FragColor = vec4(uColor, uStrength * (1.0 - clear));
}`;

export class FocusBubbleSystem extends createSystem({}) {
  private entity!: Entity;
  private material!: ShaderMaterial;
  private readonly eye = new Vector3();
  private readonly toBoard = new Vector3();
  private strength = 0;
  /** Read by the Playwright tests. */
  readonly view = { strength: 0, active: false };

  init(): void {
    this.material = new ShaderMaterial({
      uniforms: {
        uStrength: { value: 0 },
        uClearCos: { value: Math.cos((CLEAR_DEG * Math.PI) / 180) },
        uSoftCos: { value: Math.cos(((CLEAR_DEG + SOFT_DEG) * Math.PI) / 180) },
        uToBoard: { value: new Vector3(0, -0.25, -1).normalize() },
        uColor: { value: new Color('#04060b') },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: BackSide,
    });
    const mesh = new Mesh(new SphereGeometry(RADIUS, 32, 16), this.material);
    mesh.name = 'focus-bubble';
    mesh.renderOrder = -1; // before the panels: they are never dimmed, whatever their distance
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.entity = this.world.createTransformEntity(mesh);
    (window as unknown as { __bubble: FocusBubbleSystem }).__bubble = this;
    this.cleanupFuncs.push(onSettings(() => (this.view.active = this.wanted())));
  }

  update(delta: number): void {
    const active = this.wanted();
    this.view.active = active;
    if (!active && this.strength === 0) return;
    const target = active ? (inRoom(this.world) ? STRENGTH.room : STRENGTH.studio) : 0;
    const rate = (active ? 1 / IN_S : 1 / OUT_S) * delta;
    this.strength = this.strength < target ? Math.min(target, this.strength + rate) : Math.max(target, this.strength - rate);
    this.view.strength = this.strength;
    const mesh = this.entity.object3D!;
    mesh.visible = this.strength > 0;
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
      (this.material.uniforms.uToBoard.value as Vector3).copy(this.toBoard);
    }
    this.material.uniforms.uStrength.value = this.strength;
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
