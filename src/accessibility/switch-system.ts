/**
 * One switch in the app (src/accessibility/switch-access.ts). With switch mode on (?switch on the link, set up by
 * whoever helps, or "switch mode on"), the command panel's controls light up one after another, or the agent's card
 * alone while it is open, and one press selects the control lit: the space bar or Enter (what USB and Bluetooth
 * switch adapters send), or any pinch or trigger in XR, wherever it points. Whoever can press one thing, or pinch but
 * not aim, can use every control. Pointer taps on panels are ignored meanwhile (src/ui/panel-hits.ts), so a pinch
 * never also presses what its ray is on.
 *
 * The boards are reached the same way, one level down: after the console's controls, each board shown is lit whole;
 * choosing it walks that board's own controls (its Focus, its cards, its columns), so a card is picked up and dropped
 * in another column with the same one press, and the board lit whole again, last, leads back out to the console.
 *
 * The surface is checked a few times a second (a short list of keys, rebuilt only when it changes); the highlight is
 * the panels' own hover plus a thick amber frame around the control lit. Hover alone is a deliberately faint lift
 * (src/ui/hover.ts), right for eyes that aim but too faint to follow a scan by: scanning wants a focus that cannot be
 * missed, wherever the user is looking.
 */
import {
  BufferAttribute,
  BufferGeometry,
  createSystem,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  VisibilityState,
  type Entity,
} from '@iwsdk/core';
import { livePanels, type GazeTarget } from '../ui/panel-hits.js';
import { accessPreferences, onAccessPreferences, setAccessPreference } from './preferences.js';
import { reachState } from './reach.js';
import { SwitchAccess, type SwitchControl } from './switch-access.js';

const CHECK_EVERY_FRAMES = 15;
/** The scan frame: amber on the panels' blues and greys, 6 mm thick, 4 mm outside the control, 3 mm in front of it. */
const OUTLINE_COLOUR = '#ffb020';
const OUTLINE_GAP = 0.004;
const OUTLINE_WIDTH = 0.006;
const OUTLINE_LIFT = 0.003;
/** Outer then inner corners (bottom-left, bottom-right, top-right, top-left); two triangles per side. */
const OUTLINE_INDEX = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

/** "plan-button" -> "Plan", "session-15" -> "Session 15": what a control is called when it is read or shown. */
const label = (key: string) => {
  const words = key.replace(/-button$/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** What a scan key lights and frames: [key] of [target] (a board's whole frame, 'board', to enter or leave it). */
interface ScanItem {
  target: GazeTarget;
  key: string;
}
const BOARD_PREFIX = 'board:';
const TIMER_PREFIX = 'timer:';
const BACK = 'back';

export class SwitchSystem extends createSystem({}) {
  private access!: SwitchAccess;
  /** The board whose own controls are being walked; null while the scan is on the console (or a modal card). */
  private board: GazeTarget | null = null;
  private readonly items = new Map<string, ScanItem>();
  private lit: GazeTarget | null = null;
  private litKey: string | null = null;
  private signature = '';
  private frame = 0;
  private readonly keys: string[] = [];
  private session: XRSession | null = null;
  private outline!: Entity;
  private corners!: BufferAttribute;
  private outlineWidth = 0;
  private outlineHeight = 0;
  private readonly matrix = new Matrix4();
  private readonly basis = new Matrix4();
  private readonly xAxis = new Vector3();
  private readonly yAxis = new Vector3();
  private readonly zAxis = new Vector3();
  /** Read by the Playwright tests. */
  readonly view = { enabled: false, surface: '', highlighted: null as string | null, outlined: false };

  init(): void {
    this.corners = new BufferAttribute(new Float32Array(8 * 3), 3);
    const geometry = new BufferGeometry().setAttribute('position', this.corners).setIndex(OUTLINE_INDEX);
    // Transparent, like the panels (UIKit draws in the transparent pass): an opaque frame is drawn first and painted over.
    const material = new MeshBasicMaterial({ color: OUTLINE_COLOUR, side: DoubleSide, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const mesh = new Mesh(geometry, material);
    mesh.name = 'switch-outline';
    mesh.renderOrder = 999; // over the panel, under the gaze ring
    mesh.frustumCulled = false; // its corners move; the bounds are never recomputed
    mesh.visible = false;
    this.outline = this.world.createTransformEntity(mesh);
    this.access = new SwitchAccess({ onHighlight: (control) => this.paint(control?.key ?? null) });
    (window as unknown as { __switch: SwitchSystem }).__switch = this;
    // The recorded demo sets a brisk scan pace, as the user's own preference would.
    (window as unknown as { __access: { set: typeof setAccessPreference } }).__access = { set: setAccessPreference };
    this.cleanupFuncs.push(
      onAccessPreferences(() => this.sync()),
      this.world.visibilityState.subscribe(() => this.bindSession()),
      () => this.access.dispose(),
    );
    this.sync();
  }

  update(): void {
    if (!accessPreferences.switchEnabled) return;
    if (++this.frame % CHECK_EVERY_FRAMES === 0) this.refresh();
    this.place();
  }

  /** On while the preference is: scanning starts with the first press, as SwitchAccess arms a surface. */
  private sync(): void {
    const enabled = accessPreferences.switchEnabled;
    if (enabled === this.view.enabled) return;
    this.view.enabled = enabled;
    if (enabled) {
      this.access.start();
      this.refresh();
    } else {
      this.access.stop();
      this.signature = '';
      this.board = null;
      this.items.clear();
      this.place();
    }
  }

  /**
   * A modal card alone while it is shown; else the board entered, its controls then "back"; else the console's
   * controls then each board shown, lit whole. Rebuilt only when what can be lit changes.
   */
  private refresh(): void {
    let modal: GazeTarget | null = null;
    let command: GazeTarget | null = null;
    for (const panel of livePanels) {
      if (panel.modal && panel.isShown()) modal = panel;
      if (panel.name === 'command' && panel.isShown()) command = panel;
    }
    if (this.board && (modal || !this.board.isShown() || livePanels.indexOf(this.board) < 0)) this.board = null;
    const controls: SwitchControl[] = [];
    this.items.clear();
    const add = (scanKey: string, target: GazeTarget, key: string, activate: () => void, name = label(scanKey)) => {
      this.items.set(scanKey, { target, key });
      controls.push({ key: scanKey, label: name, activate });
    };
    let surface = '';
    if (modal) {
      const card = modal;
      surface = card.name;
      for (const key of card.visibleKeys(this.keys)) add(key, card, key, () => card.press(key));
    } else if (this.board) {
      const board = this.board;
      surface = board.name;
      for (const key of board.visibleKeys(this.keys)) if (key !== 'board') add(key, board, key, () => board.press(key));
      add(BACK, board, 'board', () => this.enter(null), 'Back to the console');
    } else {
      if (command) {
        const panel = command;
        surface = panel.name;
        for (const key of panel.visibleKeys(this.keys)) add(key, panel, key, () => panel.press(key));
      }
      for (const panel of livePanels) {
        if (!panel.name.startsWith(BOARD_PREFIX) || !panel.isShown()) continue;
        const board = panel;
        add(board.name, board, 'board', () => this.enter(board), 'Board');
        if (!surface) surface = 'boards';
      }
      // A focus timer's few buttons (pause, five more minutes, close) are lit directly, after the boards.
      for (const panel of livePanels) {
        if (!panel.name.startsWith(TIMER_PREFIX) || !panel.isShown()) continue;
        const timer = panel;
        for (const key of timer.visibleKeys(this.keys)) add(`${timer.name}:${key}`, timer, key, () => timer.press(key), label(key));
        if (!surface) surface = 'boards';
      }
    }
    const signature = `${surface}:${controls.map((c) => c.key).join(',')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.view.surface = surface;
    this.access.setSurface(surface, controls);
  }

  /** Into a board's own controls, or back out to the console (null): the next press starts that scan. */
  private enter(board: GazeTarget | null): void {
    this.board = board;
    this.refresh();
  }

  private paint(scanKey: string | null): void {
    const item = scanKey == null ? null : (this.items.get(scanKey) ?? null);
    if (this.lit && this.lit !== item?.target) this.lit.setScanHover(null);
    this.lit = item?.target ?? null;
    this.litKey = item?.key ?? null;
    this.lit?.setScanHover(this.litKey);
    this.view.highlighted = scanKey;
    this.place(); // at once: the scan's clock is not the frame's
  }

  /** The frame follows the control lit every frame (panels move with the body's comfort); hidden when none is. */
  private place(): void {
    const outline = this.outline.object3D!;
    const shown = accessPreferences.switchEnabled && this.litKey != null && !!this.lit?.matrixOf(this.litKey, this.matrix);
    this.view.outlined = shown;
    if (!shown) {
      outline.visible = false;
      return;
    }
    // The control's matrix maps the unit square onto it: its first two columns are its width and height in metres.
    const e = this.matrix.elements;
    const width = this.xAxis.set(e[0], e[1], e[2]).length();
    const height = this.yAxis.set(e[4], e[5], e[6]).length();
    this.xAxis.divideScalar(width);
    this.yAxis.divideScalar(height);
    this.zAxis.crossVectors(this.xAxis, this.yAxis);
    outline.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.xAxis, this.yAxis, this.zAxis));
    outline.position.set(e[12], e[13], e[14]).addScaledVector(this.zAxis, OUTLINE_LIFT);
    if (Math.abs(width - this.outlineWidth) > 0.0005 || Math.abs(height - this.outlineHeight) > 0.0005) this.resize(width, height);
    outline.visible = true;
  }

  private resize(width: number, height: number): void {
    this.outlineWidth = width;
    this.outlineHeight = height;
    const ix = width / 2 + OUTLINE_GAP;
    const iy = height / 2 + OUTLINE_GAP;
    const ox = ix + OUTLINE_WIDTH;
    const oy = iy + OUTLINE_WIDTH;
    const c = this.corners;
    c.setXYZ(0, -ox, -oy, 0).setXYZ(1, ox, -oy, 0).setXYZ(2, ox, oy, 0).setXYZ(3, -ox, oy, 0);
    c.setXYZ(4, -ix, -iy, 0).setXYZ(5, ix, -iy, 0).setXYZ(6, ix, iy, 0).setXYZ(7, -ix, iy, 0);
    c.needsUpdate = true;
  }

  /** In XR any pinch or trigger is the switch. */
  private bindSession(): void {
    const session = this.world.visibilityState.peek() === VisibilityState.NonImmersive ? null : (this.world.session ?? null);
    if (session === this.session) return;
    this.session?.removeEventListener('selectstart', this.press);
    this.session?.removeEventListener('selectend', this.release);
    this.session = session;
    session?.addEventListener('selectstart', this.press);
    session?.addEventListener('selectend', this.release);
  }

  private readonly press = (): void => {
    if (accessPreferences.switchEnabled && !reachState.measuring) this.access.pressSwitch(); // a reach pinch measures
  };

  private readonly release = (): void => this.access.releaseSwitch();
}
