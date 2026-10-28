/**
 * Panels pinned in space (boards and timers): a UIKit panel on a root at the workspace pose, plus a grab bar
 * under it. The bar, not the panel, is grabbable, so a pinch on a card is always a tap and never drags the board.
 * While the bar is held the panel follows it and keeps turning to face the user; on release the new pose is
 * dispatched as an undoable set_pose. Per frame this only touches panels that are being held.
 */
import {
  BoxGeometry,
  createSystem,
  DistanceGrabbable,
  Grabbed,
  Group,
  Hovered,
  Mesh,
  MeshStandardMaterial,
  MovementMode,
  OneHandGrabbable,
  PanelDocument,
  PanelUI,
  RayInteractable,
  Vector3,
  type Entity,
  type Object3D,
  type UIKitDocument,
  type World,
} from '@iwsdk/core';
import type { Pose } from './model.js';
import { PinnedHandle, PinnedItem } from './components.js';
import { workspace } from './store.js';
import { placeSmoothly, stopGlide } from '../ui/glide.js';
import { castShadow } from '../ui/panel-shadows.js';

const HANDLE_HEIGHT = 0.06; // >= 6 cm target (ROADMAP heuristic A)
const HANDLE_GAP = 0.025;
const HANDLE_COLOR = 0x3a4452;
const HANDLE_HOVER_COLOR = 0x6d7a8c;

const panels = new Map<string, PinnedPanel>();

export class PinnedPanel {
  readonly root: Entity;
  readonly panel: Entity;
  readonly handle: Entity;
  document: UIKitDocument | null = null;
  private readonly offset: Vector3;
  private readonly material: MeshStandardMaterial;
  private readyCallbacks: ((document: UIKitDocument) => void)[] = [];
  /** Stops this panel's shadow (src/ui/panel-shadows.ts). */
  private readonly unshadow: () => void;

  constructor(
    world: World,
    readonly item: string,
    config: string,
    readonly size: { width: number; height: number },
    handleWidth: number,
  ) {
    this.root = world.createTransformEntity(new Group());
    this.root.object3D!.rotation.order = 'YXZ';
    this.root.object3D!.name = `${item}:pinned`; // what a glide's sound follows (src/ui/sounds.ts), by name in the tests
    this.unshadow = castShadow(this.root.object3D!, size); // a soft shadow behind it, so it sits in the space

    this.panel = world.createTransformEntity(undefined, { parent: this.root });
    this.panel.addComponent(PanelUI, { config });
    this.panel.addComponent(RayInteractable);
    this.panel.addComponent(PinnedItem, { item });

    this.material = new MeshStandardMaterial({ color: HANDLE_COLOR, roughness: 0.55, metalness: 0.1 });
    const bar = new Mesh(new BoxGeometry(handleWidth, HANDLE_HEIGHT, 0.014), this.material);
    bar.rotation.order = 'YXZ';
    bar.name = `${item}:handle`;
    this.handle = world.createTransformEntity(bar);
    this.handle.addComponent(RayInteractable);
    this.handle.addComponent(PinnedHandle, { item });
    this.handle.addComponent(DistanceGrabbable, {
      movementMode: MovementMode.MoveAtSource,
      rotate: false,
      scale: false,
      translate: true,
    });
    this.handle.addComponent(OneHandGrabbable, { rotate: false, translate: true });

    this.offset = new Vector3(0, -(size.height / 2 + HANDLE_GAP + HANDLE_HEIGHT / 2), 0);
    panels.set(item, this);
  }

  /** Runs once the UIKit document has loaded (immediately if it already has). */
  whenReady(callback: (document: UIKitDocument) => void): void {
    if (this.document) callback(this.document);
    else this.readyCallbacks.push(callback);
  }

  attach(document: UIKitDocument): void {
    if (this.document) return;
    this.document = document;
    document.setTargetDimensions(this.size.width, this.size.height); // UIKit centimetres -> real metres
    for (const callback of this.readyCallbacks) callback(document);
    this.readyCallbacks = [];
  }

  /**
   * Puts the panel at the pose, at the scale the workspace's view asks for (1 on a Quest), and snaps the bar back
   * under it (unless someone is holding the bar). With [smooth] it slides there (src/ui/glide.ts) and the bar follows
   * it all the way; a panel in someone's hand is never slid.
   */
  place(pose: Pose, smooth = false): void {
    const root = this.root.object3D!;
    placeSmoothly(root, pose, workspace.panelScale, smooth, {
      hold: () => this.handle.hasComponent(Grabbed),
      moved: () => {
        const bar = this.handle.object3D;
        if (!bar) return; // the panel was disposed while it slid
        bar.scale.setScalar(root.scale.x);
        if (!this.handle.hasComponent(Grabbed)) this.snapHandle();
      },
    });
  }

  /** While held: the panel hangs above the bar and turns to face the eyes. */
  followHandle(eye: Vector3): void {
    const root = this.root.object3D!;
    const bar = this.handle.object3D!;
    turnToFace(root, bar.position, eye);
    const offset = scratch.copy(this.offset).multiplyScalar(root.scale.x).applyQuaternion(root.quaternion);
    root.position.copy(bar.position).sub(offset);
    turnToFace(root, root.position, eye);
    bar.quaternion.copy(root.quaternion);
  }

  /** The current pose, turned to face the eyes: what a release commits. */
  poseFacing(eye: Vector3): Pose {
    const root = this.root.object3D!;
    turnToFace(root, root.position, eye);
    return { x: root.position.x, y: root.position.y, z: root.position.z, yaw: root.rotation.y, pitch: root.rotation.x };
  }

  setHover(hovered: boolean): void {
    this.material.color.setHex(hovered ? HANDLE_HOVER_COLOR : HANDLE_COLOR);
  }

  setVisible(visible: boolean): void {
    this.root.object3D!.visible = visible;
    this.setHandleVisible(visible);
  }

  /** A hidden bar also stops taking rays (pointer-events skips objects marked 'none'). */
  setHandleVisible(visible: boolean): void {
    const bar = this.handle.object3D! as Object3D & { pointerEvents?: string };
    bar.visible = visible;
    bar.pointerEvents = visible ? undefined : 'none';
  }

  dispose(): void {
    panels.delete(this.item);
    if (this.root.object3D) stopGlide(this.root.object3D); // a panel that slides away is not moved any more
    this.unshadow();
    this.panel.destroy();
    this.root.destroy();
    this.handle.destroy();
    this.material.dispose();
  }

  private snapHandle(): void {
    const root = this.root.object3D!;
    const bar = this.handle.object3D!;
    bar.position.copy(this.offset).multiplyScalar(root.scale.x).applyQuaternion(root.quaternion).add(root.position);
    bar.quaternion.copy(root.quaternion);
  }
}

const scratch = new Vector3();

/** Yaw toward the eyes (panels face +Z: atan2(dx, dz)), pitched so a panel below eye level leans back. */
function turnToFace(object: Object3D, from: Vector3, eye: Vector3): void {
  const dx = eye.x - from.x;
  const dz = eye.z - from.z;
  object.rotation.order = 'YXZ';
  object.rotation.set(Math.atan2(from.y - eye.y, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0);
}

/**
 * Attaches loaded panel documents, highlights hovered bars, and moves held panels. Register it before the board
 * and timer systems.
 */
export class PinnedSystem extends createSystem({
  ready: { required: [PinnedItem, PanelDocument] },
  hoveredHandles: { required: [PinnedHandle, Hovered] },
  heldHandles: { required: [PinnedHandle, Grabbed] },
}) {
  private readonly eye = new Vector3();

  init(): void {
    this.queries.ready.subscribe('qualify', (entity) => {
      const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
      const pinned = panels.get(entity.getValue(PinnedItem, 'item') as string);
      if (document && pinned) pinned.attach(document);
    });
    this.queries.hoveredHandles.subscribe('qualify', (entity) => this.handleOf(entity)?.setHover(true));
    this.queries.hoveredHandles.subscribe('disqualify', (entity) => this.handleOf(entity)?.setHover(false));
    this.queries.heldHandles.subscribe('disqualify', (entity) => {
      const pinned = this.handleOf(entity);
      if (!pinned) return;
      this.world.camera.getWorldPosition(this.eye);
      workspace.dispatch({ op: 'set_pose', id: pinned.item, pose: pinned.poseFacing(this.eye) }, { label: 'move' });
    });
  }

  update(): void {
    if (this.queries.heldHandles.entities.size === 0) return;
    this.world.camera.getWorldPosition(this.eye);
    for (const entity of this.queries.heldHandles.entities) this.handleOf(entity)?.followHandle(this.eye);
  }

  private handleOf(entity: Entity): PinnedPanel | undefined {
    return panels.get(entity.getValue(PinnedHandle, 'item') as string);
  }
}
