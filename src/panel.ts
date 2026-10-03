import { createSystem, UIKitMLAsset, VisibilityState, type UIKit } from '@iwsdk/core';
import { BackendLink, type LinkState } from './backend/link.js';

// Status colours on the dark panel: all >= 7:1 against #15181e (ROADMAP heuristic B).
const COLORS = { online: '#5ee0a0', connecting: '#f2b84b', offline: '#ff8a7a' } as const;

/**
 * Command panel: enter/exit XR and the live connection to the command server. The panel is only touched
 * when the link state changes, never per frame.
 */
export class PanelSystem extends createSystem({}) {
  private link: BackendLink | null = null;

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('command-panel');
    const xrButton = panel?.getElementById('xr-button');
    const exitButton = panel?.getElementById('exit-button');
    const dot = panel?.getElementById<UIKit.Text>('status-dot');
    const text = panel?.getElementById<UIKit.Text>('status-text');
    const detail = panel?.getElementById<UIKit.Text>('status-detail');

    this.link = new BackendLink((state) => this.show(state, dot, text, detail));
    this.link.start();
    this.cleanupFuncs.push(() => this.link?.stop());

    if (xrButton == null || exitButton == null) return;
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      return;
    }
    const launchXR = () => this.world.launchXR();
    const exitXR = () => this.world.exitXR();
    xrButton.addEventListener('click', launchXR);
    exitButton.addEventListener('click', exitXR);
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      () => exitButton.removeEventListener('click', exitXR),
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
      }),
    );
  }

  private show(state: LinkState, dot?: UIKit.Text | null, text?: UIKit.Text | null, detail?: UIKit.Text | null): void {
    (window as unknown as { __link: LinkState }).__link = state; // read by the end-to-end smoke test
    switch (state.kind) {
      case 'online':
        dot?.setProperties({ backgroundColor: COLORS.online });
        text?.setProperties({ text: 'Command server online' });
        detail?.setProperties({
          text: state.clockSynced ? `Round trip ${Math.round(state.rttMs)} ms · clock synced` : 'Syncing clock…',
        });
        break;
      case 'connecting':
        dot?.setProperties({ backgroundColor: COLORS.connecting });
        text?.setProperties({ text: 'Connecting to the command server…' });
        break;
      case 'offline':
        dot?.setProperties({ backgroundColor: COLORS.offline });
        text?.setProperties({ text: 'Offline · your workspace keeps working' });
        detail?.setProperties({ text: `Retrying in ${Math.ceil(state.retryInMs / 1000)} s` });
        break;
    }
  }
}
