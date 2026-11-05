/**
 * "In my room": SpatialDesk in passthrough, fitted to the real room and remembered there.
 *
 *  - Two ways in: VR (the calm studio, no spatial data asked for) and the room (passthrough, with plane detection
 *    and anchors), each launched explicitly so a VR session never prompts for the room.
 *  - Fit to room (button or voice): from the planes the headset detected (IWSDK's SceneUnderstandingSystem), the
 *    board you work on stands on your desk and the parked boards hang on your walls (src/room/fit.ts). One undo step.
 *  - Remembered: the fit creates a persistent anchor in the room and keeps every board's pose relative to it. The next
 *    time you enter the room, even after reorganising in VR, the anchor is restored and each board goes back where you
 *    left it on your desk and walls. The app remembers one room, so each fit replaces the anchor before it: the site's
 *    limit (Meta documents 8) is never reached, and a layout is never saved under a handle it does not belong to.
 * Per frame this only reads the anchor pose; planes are read when fitting.
 */
import { createSystem, SceneUnderstandingSystem, SessionMode, VisibilityState, XRPlane, type World } from '@iwsdk/core';
import type { Pose } from '../workspace/model.js';
import { workspace } from '../workspace/store.js';
import { deskPose } from '../workspace/viewer.js';
import { announceAnchored } from '../ui/anchor-feedback.js';
import { seat } from '../onboarding/setup-state.js';
import { fitToRoom, invertRigid, isSeat, matrixPose, multiply, poseMatrix, type RoomPlane, type Vec3 } from './fit.js';

const KEY = 'spatialdesk.room';
const OUTLINE_MS = 2500;
const SAVE_DELAY_MS = 500;
/** "A site can currently only create 8 persistent anchors at a time" (Meta's WebXR mixed reality guide). */
const MAX_PERSISTENT = 8;
/** How long a deletion gets to answer: the WebXR Anchors draft's steps never say to resolve its promise. */
const DELETE_WAIT_MS = 1_000;
/**
 * Where IWSDK's SceneUnderstandingSystem keeps the id of its own persistent anchor. It reads that anchor every frame, so
 * deleting it would stop the render loop: the site always holds this one, and at most one of ours.
 */
const IWSDK_ANCHOR_KEY = 'iwsdk_scene_anchor_uuid';

interface SavedRoom {
  uuid: string;
  items: Record<string, Pose>;
  /** The focus plant on the desk, relative to the anchor like the items. */
  plant?: Pose;
}

interface NativePlane {
  orientation?: string;
  semanticLabel?: string;
  polygon?: ReadonlyArray<{ x: number; z: number }>;
}

type PersistentAnchor = XRAnchor & { requestPersistentHandle?: () => Promise<string> };
type RoomSession = XRSession & {
  persistentAnchors?: readonly string[];
  restorePersistentAnchor?: (uuid: string) => Promise<XRAnchor>;
  deletePersistentAnchor?: (uuid: string) => Promise<void>;
};

/** VR: hands, and eye gaze where the headset has it. Nothing about the room is asked for. */
export function launchVR(world: World): void {
  world.launchXR({ sessionMode: SessionMode.ImmersiveVR, features: { handTracking: true, gazeTracking: true } });
}

/** The room: passthrough, with the planes and anchors that fitting and remembering need. */
export function launchRoom(world: World): void {
  world.launchXR({
    sessionMode: SessionMode.ImmersiveAR,
    features: { handTracking: true, gazeTracking: true, planeDetection: true, anchors: true },
  });
}

/** True while the session shows the real room (passthrough). */
export function inRoom(world: World): boolean {
  const mode = world.session?.environmentBlendMode;
  return mode === 'alpha-blend' || mode === 'additive';
}

function readSaved(): SavedRoom | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SavedRoom | null;
    return saved && typeof saved.uuid === 'string' && saved.items ? saved : null;
  } catch {
    return null;
  }
}

function writeSaved(room: SavedRoom): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(room));
  } catch {
    // storage blocked: the room is remembered for this visit only
  }
}

function clearSaved(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing was kept
  }
}

function iwsdkAnchor(): string | null {
  try {
    return localStorage.getItem(IWSDK_ANCHOR_KEY);
  } catch {
    return null;
  }
}

/** Settles whatever happens, and soon. */
function deletePersistent(session: RoomSession, uuid: string): Promise<unknown> {
  const deleted = Promise.resolve(session.deletePersistentAnchor?.(uuid)).catch(() => undefined);
  return Promise.race([deleted, new Promise((resolve) => setTimeout(resolve, DELETE_WAIT_MS))]);
}

export class RoomSystem extends createSystem({ planes: { required: [XRPlane] } }) {
  private anchor: XRAnchor | null = null;
  private anchorMatrix: number[] | null = null;
  private uuid: string | null = null;
  /** The latest restore or fit: an answer that arrives after a newer one, or after leaving the room, is dropped. */
  private anchorTurn = 0;
  private fitRequested = false;
  /** Said by the user ("I'm on the sofa"); unset, the comfort profile's posture decides. */
  private fitLow: boolean | undefined;
  private restorePending = false;
  private wasInRoom = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private outlineTimer: ReturnType<typeof setTimeout> | null = null;
  /** Where the focus plant stands in the room (on the real desk), once fitted or restored; null elsewhere. */
  plantPose: Pose | null = null;
  /** Read by the Playwright tests and the command panel. */
  readonly state = { inRoom: false, planes: 0, lastFit: null as null | { desk: boolean; walls: number; moved: number }, restored: 0, saved: false };

  init(): void {
    this.state.saved = readSaved() != null;
    (window as unknown as { __room: RoomSystem }).__room = this;
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibility) => {
        if (visibility === VisibilityState.NonImmersive) {
          this.endRoom();
          return;
        }
        if (!this.wasInRoom && inRoom(this.world)) this.startRoom();
      }),
      workspace.subscribe(({ source }) => {
        if (source !== 'load' && this.state.inRoom && this.anchorMatrix && !this.restorePending) this.scheduleSave();
      }),
      () => {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        if (this.outlineTimer) clearTimeout(this.outlineTimer);
      },
    );
  }

  /** A saved room layout exists: entering the room puts the boards back (the panel then skips its re-anchoring). */
  get remembers(): boolean {
    return this.state.saved;
  }

  /**
   * Fit to room, from the button or by voice. Runs in the next XR frame (anchors are created inside a frame). [low]: the
   * user said they are on the sofa or in bed, so a low surface counts (otherwise only a reclined comfort profile does).
   */
  requestFit(low?: boolean): boolean {
    if (!this.state.inRoom) {
      workspace.notify({ text: 'Fit to room works in passthrough: press "In my room" first.', error: true });
      return false;
    }
    this.fitRequested = true;
    // Said just now wins; else the seat chosen in the guided setup (a sofa or bed); else the comfort profile decides.
    this.fitLow = low ?? (seat() === 'sofa' ? true : undefined);
    return true;
  }

  update(): void {
    if (!this.state.inRoom) return;
    if (this.fitRequested) {
      this.fitRequested = false;
      this.fit();
    }
    if (this.anchor) this.readAnchor();
    if (this.restorePending && this.anchorMatrix) this.restore();
  }

  private startRoom(): void {
    this.wasInRoom = true;
    this.state.inRoom = true;
    const saved = readSaved();
    const session = this.world.session as RoomSession | null;
    if (!saved || !session?.restorePersistentAnchor) return;
    this.restorePending = true;
    const turn = ++this.anchorTurn;
    session
      .restorePersistentAnchor(saved.uuid)
      .then((anchor) => {
        if (turn !== this.anchorTurn) return;
        this.anchor = anchor;
        this.uuid = saved.uuid;
      })
      .catch(() => {
        if (turn !== this.anchorTurn) return;
        // The room changed or the anchor was erased: the layout stays where it is until the next fit.
        this.restorePending = false;
        workspace.notify({ text: 'I could not find your room layout here. Press "Fit room" to place it again.', error: false });
      });
  }

  private endRoom(): void {
    this.wasInRoom = false;
    this.state.inRoom = false;
    this.anchorTurn++;
    this.anchor = null;
    this.anchorMatrix = null;
    this.restorePending = false;
    this.plantPose = null;
    this.state.planes = 0;
  }

  private readAnchor(): void {
    const frame = this.world.renderer.xr.getFrame();
    const space = this.world.renderer.xr.getReferenceSpace();
    const pose = space && this.anchor ? frame?.getPose(this.anchor.anchorSpace, space) : null;
    if (pose) this.anchorMatrix = Array.from(pose.transform.matrix);
  }

  private planes(): RoomPlane[] {
    const planes: RoomPlane[] = [];
    for (const entity of this.queries.planes.entities) {
      const native = entity.getValue(XRPlane, '_plane') as NativePlane | undefined;
      const object = entity.object3D;
      if (!native || !object) continue;
      object.updateWorldMatrix(true, false);
      const m = object.matrixWorld.elements;
      let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of native.polygon ?? []) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      if (!Number.isFinite(minX)) continue;
      planes.push({
        orientation: native.orientation === 'vertical' ? 'vertical' : 'horizontal',
        label: native.semanticLabel ?? 'other',
        center: [m[12], m[13], m[14]],
        normal: [m[4], m[5], m[6]] as Vec3,
        tangent: [m[0], m[1], m[2]] as Vec3,
        min: [minX, minZ],
        max: [maxX, maxZ],
      });
    }
    this.state.planes = planes.length;
    return planes;
  }

  private fit(): void {
    // Where the user sits facing the desk: pressing Fit room on the console, they look at the console, not the desk.
    const viewer = deskPose(this.world);
    const result = fitToRoom(workspace.state, viewer, this.planes(), workspace.panelScale, { low: this.fitLow });
    this.fitLow = undefined;
    this.showOutlines();
    if (result.poses.length === 0) {
      this.state.lastFit = { desk: false, walls: 0, moved: 0 };
      workspace.notify({ text: "I can't see your desk or walls yet. Look around the room for a moment, then try again.", error: false });
      return;
    }
    const on = result.desk ? (isSeat(result.desk.label) ? `your ${result.desk.label === 'bed' ? 'bed' : 'sofa'}` : 'your desk') : '';
    const parts = [result.desk ? `the board stands on ${on}` : '', result.walls ? `${result.walls} board${result.walls === 1 ? ' hangs' : 's hang'} on your walls` : ''].filter(Boolean);
    const applied = workspace.dispatch(
      result.poses.map(({ id, pose }) => ({ op: 'set_pose' as const, id, pose })),
      { label: 'fit to room', notice: `Fitted to your room: ${parts.join(', ')}. It will be here next time.` },
    );
    this.state.lastFit = { desk: result.desk != null, walls: result.walls, moved: applied.ok ? result.poses.length : 0 };
    if (applied.ok) {
      if (result.plant) this.plantPose = result.plant;
      this.anchorHere(viewer);
      if (result.desk) announceAnchored('surface'); // the board now stands on a surface: a flash and a faint pulse
    }
  }

  /** A persistent anchor on the floor under the viewer: the room layout is kept relative to it. */
  private anchorHere(viewer: Pose): void {
    const frame = this.world.renderer.xr.getFrame() as (XRFrame & { createAnchor?: XRFrame['createAnchor'] }) | null;
    const space = this.world.renderer.xr.getReferenceSpace();
    if (!frame?.createAnchor || !space) return;
    const turn = ++this.anchorTurn;
    this.restorePending = false; // this fit replaces what a restore on its way would bring back
    frame
      .createAnchor(new XRRigidTransform({ x: viewer.x, y: 0, z: viewer.z }), space)
      ?.then(async (anchor) => {
        if (turn !== this.anchorTurn) {
          anchor.delete();
          return;
        }
        this.anchor?.delete();
        this.anchor = anchor;
        this.anchorMatrix = poseMatrix({ x: viewer.x, y: 0, z: viewer.z, yaw: 0, pitch: 0 });
        this.uuid = null; // from here on, nothing may be saved under the old handle
        const uuid = await this.persist(anchor);
        if (turn !== this.anchorTurn) return; // a handle left behind goes with the next fit
        this.uuid = uuid;
        if (uuid) {
          this.save();
        } else {
          clearSaved();
          this.state.saved = false;
          workspace.notify({ text: 'Fitted for this visit: the headset could not remember this room.', error: false });
        }
      })
      .catch(() => {
        // No anchors on this device: the fit still stands for this session.
      });
  }

  /** Every earlier anchor goes first, then the new handle; null if the headset will not keep it. */
  private async persist(anchor: PersistentAnchor): Promise<string | null> {
    const session = this.world.session as RoomSession | null;
    if (!session || !anchor.requestPersistentHandle) return null;
    const earlier = new Set<string>();
    const ours = readSaved()?.uuid;
    if (ours) earlier.add(ours);
    // Any other is left over from an earlier version, unless it is IWSDK's: while its id is not known yet, none is touched.
    const iwsdk = iwsdkAnchor();
    if (iwsdk) {
      for (const uuid of session.persistentAnchors ?? []) if (uuid !== iwsdk) earlier.add(uuid);
    }
    await Promise.all([...earlier].map((uuid) => deletePersistent(session, uuid)));
    if ((session.persistentAnchors?.length ?? 0) >= MAX_PERSISTENT) return null;
    return anchor.requestPersistentHandle().catch(() => null);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  /** Every board's and timer's pose, relative to the room anchor. */
  private save(): void {
    if (!this.uuid || !this.anchorMatrix) return;
    const toAnchor = invertRigid(this.anchorMatrix);
    const items: Record<string, Pose> = {};
    for (const item of [...workspace.state.boards, ...workspace.state.timers]) items[item.id] = matrixPose(multiply(toAnchor, poseMatrix(item.pose)));
    const plant = this.plantPose ? matrixPose(multiply(toAnchor, poseMatrix(this.plantPose))) : undefined;
    writeSaved({ uuid: this.uuid, items, plant });
    this.state.saved = true;
  }

  /** The anchor is back: every remembered board and timer returns to its place in the room. */
  private restore(): void {
    this.restorePending = false;
    const saved = readSaved();
    const anchor = this.anchorMatrix;
    if (!saved || !anchor) return;
    if (saved.plant) this.plantPose = matrixPose(multiply(anchor, poseMatrix(saved.plant)));
    const present = new Set([...workspace.state.boards, ...workspace.state.timers].map((item) => item.id));
    const ops = Object.entries(saved.items)
      .filter(([id]) => present.has(id))
      .map(([id, relative]) => ({ op: 'set_pose' as const, id, pose: matrixPose(multiply(anchor, poseMatrix(relative))) }));
    if (ops.length === 0) return;
    const result = workspace.dispatch(ops, { undoable: false, notice: 'Welcome back: your boards are where you left them in your room.' });
    if (result.ok) this.state.restored = ops.length;
  }

  /** The detected planes glow for a moment, so the user sees what the fit used. */
  private showOutlines(): void {
    const understanding = this.world.getSystem(SceneUnderstandingSystem);
    if (!understanding) return;
    understanding.config.showWireFrame.value = true;
    if (this.outlineTimer) clearTimeout(this.outlineTimer);
    this.outlineTimer = setTimeout(() => (understanding.config.showWireFrame.value = false), OUTLINE_MS);
  }
}
