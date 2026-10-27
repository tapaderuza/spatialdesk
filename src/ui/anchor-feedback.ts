/**
 * Feedback when the space settles where the body can use it: a short amber frame round the work board that fades in
 * 0.6 s, and one faint pulse in the controllers that have a vibration motor. Two moments count:
 *   - the space is moved onto the body's reach (the comfort profile's reach, tilt or side changed: "fit to my reach",
 *     or the agent's answer to what is hard today), and
 *   - Fit room stood the board on a surface (src/room/room-system.ts calls [announceAnchored]).
 * Someone who cannot see well, or whose hands have no motor, still gets the sound cue the panels already make; this adds
 * the other two senses, and costs nothing between events: one hidden mesh, nothing per frame while it is hidden, no
 * allocation while it fades. The pulse is a request the controller answers on its own (never awaited).
 */
import { BufferAttribute, BufferGeometry, createSystem, DoubleSide, Mesh, MeshBasicMaterial, type Entity } from '@iwsdk/core';
import { BOARD_SIZE } from '../workspace/model.js';
import { workspace } from '../workspace/store.js';

export type AnchorKind = 'reach' | 'surface';

const listeners = new Set<(kind: AnchorKind) => void>();

/** Said by whoever has just settled the space (Fit room); the system flashes and pulses. */
export function announceAnchored(kind: AnchorKind): void {
  for (const listener of listeners) listener(kind);
}

const FLASH_MS = 600;
const PEAK_OPACITY = 0.9;
const HAPTIC_INTENSITY = 0.25;
const HAPTIC_MS = 35;
/** The frame: 5 mm outside the board's edge and 8 mm thick, in the same amber as the one-switch scan. */
const GAP = 0.005;
const THICKNESS = 0.008;
/** Outer then inner corners (bottom-left, bottom-right, top-right, top-left); two triangles per side. */
const FRAME_INDEX = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

type Pulsing = { gamepad?: { hapticActuators?: { pulse?: (intensity: number, ms: number) => unknown }[] } | null };

export class AnchorFeedbackSystem extends createSystem({}) {
  private frame!: Entity;
  private material!: MeshBasicMaterial;
  private startedAt = -1;
  /** Read by the Playwright tests. */
  readonly view = { flashes: 0, pulses: 0, last: null as AnchorKind | null, visible: false };

  init(): void {
    const ix = BOARD_SIZE.width / 2 + GAP;
    const iy = BOARD_SIZE.height / 2 + GAP;
    const ox = ix + THICKNESS;
    const oy = iy + THICKNESS;
    const corners = new BufferAttribute(
      new Float32Array([-ox, -oy, 0, ox, -oy, 0, ox, oy, 0, -ox, oy, 0, -ix, -iy, 0, ix, -iy, 0, ix, iy, 0, -ix, iy, 0]),
      3,
    );
    const geometry = new BufferGeometry().setAttribute('position', corners).setIndex(FRAME_INDEX);
    // Transparent, like the panels (UIKit draws in the transparent pass): an opaque frame would be painted over.
    this.material = new MeshBasicMaterial({ color: '#ffb020', side: DoubleSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
    const mesh = new Mesh(geometry, this.material);
    mesh.name = 'anchor-flash';
    mesh.renderOrder = 998; // over the panels, under the scan frame and the gaze ring
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.rotation.order = 'YXZ';
    this.frame = this.world.createTransformEntity(mesh);
    (window as unknown as { __anchor: unknown }).__anchor = { view: this.view, announce: (kind: AnchorKind) => announceAnchored(kind) };
    const onAnchored = (kind: AnchorKind) => this.trigger(kind);
    listeners.add(onAnchored);
    this.cleanupFuncs.push(
      () => listeners.delete(onAnchored),
      // The space moved onto the body's reach: any change of reach, tilt or side (not the first load).
      workspace.subscribe((change) => {
        const before = change.previous?.comfort;
        const now = change.state.comfort;
        if (change.source === 'load' || !before) return;
        if (before.reach !== now.reach || before.tiltDeg !== now.tiltDeg || before.side !== now.side) this.trigger('reach');
      }),
    );
  }

  update(): void {
    if (this.startedAt < 0) return;
    const t = (performance.now() - this.startedAt) / FLASH_MS;
    const mesh = this.frame.object3D!;
    if (t >= 1) {
      this.startedAt = -1;
      mesh.visible = false;
      this.material.opacity = 0;
      this.view.visible = false;
      return;
    }
    this.material.opacity = PEAK_OPACITY * (1 - t) * (1 - t); // fast, then a long fade
  }

  private trigger(kind: AnchorKind): void {
    const focus = workspace.state.boards.find((board) => board.id === workspace.state.focusBoardId);
    if (!focus) return;
    const mesh = this.frame.object3D!;
    mesh.position.set(focus.pose.x, focus.pose.y, focus.pose.z);
    mesh.rotation.set(focus.pose.pitch, focus.pose.yaw, 0);
    mesh.scale.setScalar(workspace.panelScale);
    mesh.visible = true;
    this.material.opacity = PEAK_OPACITY;
    this.startedAt = performance.now();
    this.view.flashes++;
    this.view.last = kind;
    this.view.visible = true;
    this.buzz();
  }

  /** One faint pulse on every controller with a motor. Hands have none; a refusal is not an error. */
  private buzz(): void {
    const session = this.world.session;
    if (!session) return;
    for (const source of session.inputSources) {
      const actuator = (source as unknown as Pulsing).gamepad?.hapticActuators?.[0];
      if (!actuator?.pulse) continue;
      this.view.pulses++;
      try {
        void Promise.resolve(actuator.pulse(HAPTIC_INTENSITY, HAPTIC_MS)).catch(() => undefined);
      } catch {
        /* a controller that cannot vibrate right now */
      }
    }
  }
}
