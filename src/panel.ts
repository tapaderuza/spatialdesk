import { createSystem, UIKitMLAsset, Vector3, VisibilityState, type UIKit } from '@iwsdk/core';
import { Workspaces } from 'spatialdesk-shared';
import { BackendLink, type LinkState } from './backend/link.js';
import { heldCard, releaseHeld } from './workspace/boards.js';
import { panelText, type Pose } from './workspace/model.js';
import { workspace, type Notice } from './workspace/store.js';

const engine = Workspaces.getInstance();

// Status colours on the dark panel: all >= 7:1 against #15181e (ROADMAP heuristic B).
const COLORS = { online: '#5ee0a0', connecting: '#f2b84b', offline: '#ff8a7a' } as const;
const BUTTON = { base: '#2a313b', primary: '#2f5f9e', hover: '#9cc3ff' } as const;
const TEXT = { normal: '#eef1f5', dim: '#8b95a3', error: '#ff8a7a' } as const;
const IDLE_NOTICE = 'Tap a card to pick it up, then tap where it goes.';
const NOTICE_MS = 8000;
/** Entering XR this far from the stored anchor re-arranges the workspace around the user. */
const REANCHOR_METRES = 0.35;
const REANCHOR_RADIANS = (30 * Math.PI) / 180;

/**
 * Command panel: connection status, feedback, and the workspace-wide actions (bring everything to me, Focus 25,
 * undo, clear done, enter/exit XR). Nothing here runs per frame except a few frames of placement after entering XR.
 */
export class PanelSystem extends createSystem({}) {
  private link: BackendLink | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private placeFrames = 0;
  private anchorCheckFrames = 0;
  private readonly eye = new Vector3();
  private readonly forward = new Vector3();

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('command-panel');
    const element = (id: string) => panel?.getElementById<UIKit.Text>(id) ?? null;
    const dot = element('status-dot');
    const text = element('status-text');
    const detail = element('status-detail');
    const notice = element('notice');
    const undoLabel = element('undo-label');

    this.link = new BackendLink((state) => this.show(state, dot, text, detail));
    this.link.start();
    this.cleanupFuncs.push(() => this.link?.stop());

    this.cleanupFuncs.push(workspace.onNotice((n) => this.showNotice(n, notice)));
    const paintUndo = () =>
      undoLabel?.setProperties({
        text: workspace.undoLabel ? `Undo ${workspace.undoLabel}` : 'Undo',
        color: workspace.canUndo ? TEXT.normal : TEXT.dim,
      });
    paintUndo();
    this.cleanupFuncs.push(
      workspace.subscribe((change) => {
        paintUndo();
        const before = change.previous?.anchor;
        const after = change.state.anchor;
        if (before && (before.x !== after.x || before.z !== after.z || before.yaw !== after.yaw)) this.placeFrames = 1;
      }),
    );

    this.button(element('arrange-button'), BUTTON.base, () => this.bringToMe());
    this.button(element('focus-button'), BUTTON.primary, () => this.focus25());
    this.button(element('undo-button'), BUTTON.base, () => workspace.undo());
    this.button(element('clear-button'), BUTTON.base, () =>
      workspace.dispatch({ op: 'clear_done' }, { notice: 'Cleared the last column of every board.' }),
    );

    const xrButton = element('xr-button');
    const exitButton = element('exit-button');
    if (!this.world.xrEnabled) {
      xrButton?.setProperties({ display: 'none' });
      exitButton?.setProperties({ display: 'none' });
      return;
    }
    this.button(xrButton, BUTTON.primary, () => this.world.launchXR());
    this.button(exitButton, BUTTON.base, () => this.world.exitXR());
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton?.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton?.setProperties({ display: is2D ? 'none' : 'flex' });
        if (!is2D) {
          this.placeFrames = 3; // after ScreenSpace hands the panel back to the scene
          this.anchorCheckFrames = 10; // once the headset pose has settled
        }
      }),
    );
  }

  update(): void {
    if (this.placeFrames > 0) {
      this.placeFrames--;
      this.placeCommandPanel();
    }
    if (this.anchorCheckFrames > 0 && --this.anchorCheckFrames === 0) this.reanchorIfFar();
  }

  /**
   * The user's eye pose (yaw only): what "bring everything to me" arranges around. In the browser the camera is a
   * preview camera behind the user, so the layout keeps the default anchor it was designed around.
   */
  viewerPose(): Pose {
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) return { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
    const camera = this.world.camera;
    camera.getWorldPosition(this.eye);
    camera.getWorldDirection(this.forward);
    return { x: this.eye.x, y: this.eye.y, z: this.eye.z, yaw: Math.atan2(-this.forward.x, -this.forward.z), pitch: 0 };
  }

  private bringToMe(): void {
    workspace.dispatch({ op: 'arrange_space', layout: 'desk' }, { viewer: this.viewerPose(), notice: 'Everything is back around you.' });
  }

  /** A 25-minute timer (for the picked-up card, if any), and the other boards move out of the way. */
  private focus25(): void {
    const card = heldCard();
    releaseHeld();
    workspace.dispatch(
      [
        { op: 'start_timer', minutes: 25, ...(card ? { card: card.id } : {}) },
        { op: 'arrange_space', layout: 'focus' },
      ],
      {
        viewer: this.viewerPose(),
        label: 'focus 25',
        notice: card ? `Focus 25 on "${panelText(card.title)}". The other boards stepped back.` : 'Focus 25 started. The other boards stepped back.',
      },
    );
  }

  private reanchorIfFar(): void {
    const viewer = this.viewerPose();
    const anchor = workspace.state.anchor;
    const turn = Math.abs(Math.atan2(Math.sin(viewer.yaw - anchor.yaw), Math.cos(viewer.yaw - anchor.yaw)));
    if (Math.hypot(viewer.x - anchor.x, viewer.z - anchor.z) > REANCHOR_METRES || turn > REANCHOR_RADIANS || Math.abs(viewer.y - anchor.y) > REANCHOR_METRES) {
      workspace.dispatch({ op: 'arrange_space', layout: 'desk' }, { viewer, undoable: false, notice: 'Arranged around you.' });
    }
    this.placeFrames = 1;
  }

  private placeCommandPanel(): void {
    const object = this.world.getSceneObject('command-panel');
    if (!object || this.world.visibilityState.value === VisibilityState.NonImmersive) return;
    const pose = JSON.parse(engine.commandPose(JSON.stringify(workspace.state))) as Pose;
    object.position.set(pose.x, pose.y, pose.z);
    object.rotation.order = 'YXZ';
    object.rotation.set(pose.pitch, pose.yaw, 0);
  }

  /** Click plus hover painted by hand (a UIKitML :hover style sticks on restyled elements). */
  private button(target: UIKit.Text | null, base: string, onClick: () => void): void {
    if (!target) return;
    const click = (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      onClick();
    };
    const enter = () => target.setProperties({ borderColor: BUTTON.hover });
    const leave = () => target.setProperties({ borderColor: base });
    target.addEventListener('click', click);
    target.addEventListener('pointerenter', enter);
    target.addEventListener('pointerleave', leave);
    this.cleanupFuncs.push(() => {
      target.removeEventListener('click', click);
      target.removeEventListener('pointerenter', enter);
      target.removeEventListener('pointerleave', leave);
    });
  }

  private showNotice(notice: Notice, element: UIKit.Text | null): void {
    (window as unknown as { __notice: Notice }).__notice = notice; // read by the Playwright tests
    element?.setProperties({ text: panelText(notice.text), color: notice.error ? TEXT.error : TEXT.normal });
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => element?.setProperties({ text: IDLE_NOTICE, color: TEXT.dim }), NOTICE_MS);
  }

  private show(state: LinkState, dot?: UIKit.Text | null, text?: UIKit.Text | null, detail?: UIKit.Text | null): void {
    (window as unknown as { __link: LinkState }).__link = state; // read by the end-to-end smoke test
    switch (state.kind) {
      case 'online':
        dot?.setProperties({ backgroundColor: COLORS.online });
        text?.setProperties({ text: 'Command server online' });
        detail?.setProperties({
          text: state.clockSynced ? `Round trip ${Math.round(state.rttMs)} ms - clock synced` : 'Syncing clock...',
        });
        break;
      case 'connecting':
        dot?.setProperties({ backgroundColor: COLORS.connecting });
        text?.setProperties({ text: 'Connecting to the command server...' });
        break;
      case 'offline':
        dot?.setProperties({ backgroundColor: COLORS.offline });
        text?.setProperties({ text: 'Offline - your workspace keeps working' });
        detail?.setProperties({ text: `Retrying in ${Math.ceil(state.retryInMs / 1000)} s` });
        break;
    }
  }
}
