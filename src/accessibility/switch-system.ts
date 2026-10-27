/**
 * One switch in the app (src/accessibility/switch-access.ts). With switch mode on (?switch on the link, set up by
 * whoever helps, or "switch mode on"), the command panel's controls light up one after another, or the agent's card
 * alone while it is open, and one press selects the control lit: the space bar or Enter (what USB and Bluetooth
 * switch adapters send), or any pinch or trigger in XR, wherever it points. Whoever can press one thing, or pinch but
 * not aim, can use every control. Pointer taps on panels are ignored meanwhile (src/ui/panel-hits.ts), so a pinch
 * never also presses what its ray is on.
 *
 * The surface is checked a few times a second (a short list of keys, rebuilt only when it changes); the highlight is
 * the panels' own hover.
 */
import { createSystem, VisibilityState } from '@iwsdk/core';
import { livePanels, type GazeTarget } from '../ui/panel-hits.js';
import { accessPreferences, onAccessPreferences, setAccessPreference } from './preferences.js';
import { SwitchAccess } from './switch-access.js';

const CHECK_EVERY_FRAMES = 15;

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
  /** Read by the Playwright tests. */
  readonly view = { enabled: false, surface: '', highlighted: null as string | null };

  init(): void {
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
    if (!accessPreferences.switchEnabled || ++this.frame % CHECK_EVERY_FRAMES !== 0) return;
    this.refresh();
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
    if (accessPreferences.switchEnabled) this.access.pressSwitch();
  };

  private readonly release = (): void => this.access.releaseSwitch();
}
