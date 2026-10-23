/**
 * The VR studio around the workspace (art direction): the dusk horizon, the desk the focus board stands on, and the
 * focus plant that grows a leaf with every focus block (src/scene-assets). The desk follows the focus board's slot,
 * so it moves with "Bring to me" and refits with the headset's view; the plant stands on it. In "In my room" the real
 * room replaces the horizon and the desk, and the plant stands on the real desk beside the board (RoomSystem).
 *
 * When a focus block ends, a moment after the timer's chime, the plant unfurls its new leaf over a couple of seconds
 * with three soft notes. Nothing runs per frame except that unfurling (allocation-free) and one blend-mode check.
 */
import { createSystem, VisibilityState, type BufferGeometry, type Mesh, type Object3D } from '@iwsdk/core';
import { Workspaces } from 'spatialdesk-shared';
import { inRoom, RoomSystem } from '../room/room-system.js';
import { createPlantGeometry, writePlant } from '../scene-assets/focus-plant.scene-asset.js';
import { play } from '../ui/sounds.js';
import type { Pose, Timer } from '../workspace/model.js';
import { progress } from '../workspace/progress.js';
import { workspace } from '../workspace/store.js';
import { timerFinishedListeners } from '../workspace/timers.js';

const engine = Workspaces.getInstance();
/** The desk's centre, ahead of the eyes: its front edge sits right under the focus board's bar. */
const DESK_AHEAD = 0.74;
/** From the focus board's centre to the bottom of its bar, at scale 1 (pinned.ts: half the board, the gap, the bar). */
const BOARD_TO_BAR_BOTTOM = 0.25 + 0.025 + 0.06;
/** The plant on the studio desk, in the desk's frame: just right of the board (its half width at scale 1), nearer the user. */
const PLANT_ON_DESK = { x: 0.36, gap: 0.09, z: 0.06 } as const;
/** The new leaf waits for the timer's chime to finish, then unfurls. */
const GROW_DELAY_MS = 1500;
const GROW_MS = 2400;

export class StudioSystem extends createSystem({}) {
  private horizon: Object3D | null = null;
  private desk: Object3D | null = null;
  private plant: Mesh | null = null;
  private geometry: BufferGeometry | null = null;
  private room = false;
  private roomPlant: Pose | null = null;
  private growFrom = 0;
  private growTo = 0;
  private growStart = -1;
  private chimed = false;
  private placedFor = '';
  /** Read by the Playwright tests. */
  readonly state = { growth: 0, inRoom: false, plantVisible: false };

  init(): void {
    this.horizon = this.world.getSceneObject('studio-horizon') ?? null;
    this.desk = this.world.getSceneObject('studio-desk') ?? null;
    this.plant = findMesh(this.world.getSceneObject('focus-plant'));
    if (this.plant) {
      // The prototype's geometry is shared: this plant grows in a geometry of its own.
      this.geometry = createPlantGeometry();
      this.plant.geometry = this.geometry;
      this.state.growth = progress.totalBlocks();
      writePlant(this.geometry, this.state.growth);
    }
    (window as unknown as { __studio: StudioSystem }).__studio = this;

    const onTimer = (timer: Timer) => {
      if (/^break$/i.test(timer.label.trim())) return;
      // After every listener has run: the command panel records the block in progress first.
      queueMicrotask(() => this.grow(progress.totalBlocks()));
    };
    timerFinishedListeners.add(onTimer);
    this.cleanupFuncs.push(
      () => timerFinishedListeners.delete(onTimer),
      workspace.subscribe(({ state }) => {
        // Only the anchor and the view move the desk; card and timer changes leave it where it is.
        const { anchor: a, view: v } = state;
        const key = [a.x, a.y, a.z, a.yaw, v?.halfWidthDeg, v?.upDeg, v?.downDeg].join();
        if (key === this.placedFor) return;
        this.placedFor = key;
        if (!this.room) this.place();
      }),
      this.world.visibilityState.subscribe(() => this.place()),
    );
    this.place();
  }

  /** Grows the plant to [blocks] focus blocks, unfurling the new leaves once the timer's chime is over. */
  grow(blocks: number): void {
    if (!this.geometry || blocks <= this.state.growth) return;
    this.growFrom = this.state.growth;
    this.growTo = blocks;
    this.growStart = performance.now() + GROW_DELAY_MS;
    this.chimed = false;
  }

  update(): void {
    const room = this.world.visibilityState.peek() !== VisibilityState.NonImmersive && inRoom(this.world);
    const roomPlant = room ? (this.world.getSystem(RoomSystem)?.plantPose ?? null) : null;
    if (room !== this.room || roomPlant !== this.roomPlant) this.place();
    if (this.growStart < 0 || !this.geometry) return;
    const t = (performance.now() - this.growStart) / GROW_MS;
    if (t < 0) return;
    if (!this.chimed) {
      this.chimed = true;
      play('grow');
    }
    this.state.growth = this.growFrom + (this.growTo - this.growFrom) * Math.min(1, t);
    writePlant(this.geometry, this.state.growth);
    if (t >= 1) this.growStart = -1;
  }

  /** The studio desk under the focus board's slot and the plant on it; in the room, the plant on the real desk. */
  private place(): void {
    this.room = this.world.visibilityState.peek() !== VisibilityState.NonImmersive && inRoom(this.world);
    this.roomPlant = this.room ? (this.world.getSystem(RoomSystem)?.plantPose ?? null) : null;
    this.state.inRoom = this.room;
    if (this.horizon) this.horizon.visible = !this.room;
    if (this.desk) this.desk.visible = !this.room;
    const plant = this.plant;
    if (this.room) {
      if (plant && this.roomPlant) {
        plant.position.set(this.roomPlant.x, this.roomPlant.y, this.roomPlant.z);
        plant.rotation.set(0, this.roomPlant.yaw, 0);
      }
      if (plant) plant.visible = this.roomPlant != null;
      this.state.plantVisible = plant?.visible ?? false;
      return;
    }
    const slot = JSON.parse(engine.focusSlot(JSON.stringify(workspace.state))) as Pose;
    const top = slot.y - BOARD_TO_BAR_BOTTOM * workspace.panelScale * Math.cos(slot.pitch) - 0.002;
    const { x, z, yaw } = workspace.state.anchor;
    const [cx, cz] = [x - Math.sin(yaw) * DESK_AHEAD, z - Math.cos(yaw) * DESK_AHEAD];
    this.desk?.position.set(cx, top, cz);
    this.desk?.rotation.set(0, yaw, 0);
    if (plant) {
      // The desk's frame turned by its yaw: local (x, z) -> (x cos + z sin, -x sin + z cos).
      const px = PLANT_ON_DESK.x * workspace.panelScale + PLANT_ON_DESK.gap;
      const pz = PLANT_ON_DESK.z;
      plant.position.set(cx + px * Math.cos(yaw) + pz * Math.sin(yaw), top, cz - px * Math.sin(yaw) + pz * Math.cos(yaw));
      plant.rotation.set(0, yaw + 0.35, 0);
      plant.visible = true;
    }
    this.state.plantVisible = plant?.visible ?? false;
  }
}

/** The placed asset may be the mesh itself or a group holding it. */
function findMesh(object: Object3D | null | undefined): Mesh | null {
  let found: Mesh | null = null;
  object?.traverse((o) => {
    if (!found && (o as Mesh).isMesh) found = o as Mesh;
  });
  return found;
}
