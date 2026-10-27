/**
 * One switch in the app (src/accessibility/switch-access.ts). With switch mode on (?switch on the link, set up by
 * whoever helps, or "switch mode on"), the command panel's controls light up one after another, or the agent's card
 * alone while it is open, and one press selects the control lit: the space bar or Enter (what USB and Bluetooth
 * switch adapters send), or any pinch or trigger in XR, wherever it points. Whoever can press one thing, or pinch but
 * not aim, can use every control. Pointer taps on panels are ignored meanwhile (src/ui/panel-hits.ts), so a pinch
 * never also presses what its ray is on.
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
import { SwitchAccess } from './switch-access.js';

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

export class SwitchSystem extends createSystem({}) {
  private access!: SwitchAccess;
  private surface: GazeTarget | null = null;
  private lit: GazeTarget | null = null;
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
      this.surface = null;
      this.place();
    }
  }

  /** The agent's card alone while it is shown, else the command panel; rebuilt only when its controls change. */
  private refresh(): void {
    let surface: GazeTarget | null = null;
    for (const panel of livePanels) if (panel.modal && panel.isShown()) surface = panel;
    if (!surface) for (const panel of livePanels) if (panel.name === 'command' && panel.isShown()) surface = panel;
    const keys = surface ? surface.visibleKeys(this.keys) : this.keys.splice(0);
    const signature = surface ? `${surface.name}:${keys.join(',')}` : '';
    if (signature === this.signature) return;
    this.signature = signature;
    this.surface = surface;
    this.view.surface = surface?.name ?? '';
    const target = surface;
    this.access.setSurface(target?.name ?? '', target ? keys.map((key) => ({ key, label: label(key), activate: () => target.press(key) })) : []);
  }

  private paint(key: string | null): void {
    if (this.lit && this.lit !== this.surface) this.lit.setScanHover(null);
    this.lit = this.surface;
    this.lit?.setScanHover(key);
    this.view.highlighted = key;
    this.place(); // at once: the scan's clock is not the frame's
  }

  /** The frame follows the control lit every frame (panels move with the body's comfort); hidden when none is. */
  private place(): void {
    const outline = this.outline.object3D!;
    const key = this.view.highlighted;
    const shown = accessPreferences.switchEnabled && key != null && !!this.surface?.matrixOf(key, this.matrix);
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
