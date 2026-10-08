import { createSystem, UIKitMLAsset, VisibilityState, type UIKit } from '@iwsdk/core';
import { Workspaces } from 'spatialdesk-shared';
import { AgentSystem } from './agent/agent-system.js';
import { BackendLink, type LinkState } from './backend/link.js';
import { PanelHits } from './ui/panel-hits.js';
import { idleBorder, onSettings, settings, toggleSetting, type Settings } from './ui/settings.js';
import { play } from './ui/sounds.js';
import { heldCard, releaseHeld } from './workspace/boards.js';
import { panelText, type Pose } from './workspace/model.js';
import { TIMER_SCALE, workspace, type Notice } from './workspace/store.js';
import { deskPose, viewerPose } from './workspace/viewer.js';

const engine = Workspaces.getInstance();

// Status colours on the dark panel: all >= 7:1 against #15181e (ROADMAP heuristic B).
const COLORS = { online: '#5ee0a0', connecting: '#f2b84b', offline: '#ff8a7a' } as const;
const BUTTON = { base: '#2a313b', primary: '#2f5f9e', hover: '#9cc3ff' } as const;
const TEXT = { normal: '#eef1f5', dim: '#8b95a3', error: '#ff8a7a' } as const;
// The notice line: amber text and border while the agent has a nudge waiting there.
const NOTICE = { base: '#1d222a', nudge: '#f2b84b' } as const;
const COACH_BORDER = '#f2b84b';
let commandHighlight: string | null = null;
let repaintCommand: (() => void) | null = null;

/** The onboarding coach outlines one command panel button ("focus", "plan"...); null clears it. */
export function setCommandHighlight(key: string | null): void {
  commandHighlight = key;
  repaintCommand?.();
}
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

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('command-panel');
    const element = (id: string) => {
      const found = panel?.getElementById<UIKit.Text>(id) ?? null;
      if (found) found.name = `command:${id}`; // addressable from tests and the IWSDK CLI
      return found;
    };
    const root = element('command-root');
    const dot = element('status-dot');
    const text = element('status-text');
    const detail = element('status-detail');
    const notice = element('notice');
    const undoLabel = element('undo-label');

    this.link = new BackendLink((state) => this.show(state, dot, text, detail));
    this.link.start();
    this.cleanupFuncs.push(() => this.link?.stop());

    this.cleanupFuncs.push(workspace.onNotice((n) => this.showNotice(n, notice)));
    if (TIMER_SCALE !== 1) this.showNotice({ text: 'Fast timers are on: every minute runs as one second.', error: false }, notice);
    // The agent's nudges ("X is running over") wait on the notice line, in amber, until tapped or replaced.
    const agent = this.world.getSystem(AgentSystem);
    if (agent) {
      this.cleanupFuncs.push(
        agent.onNudge((nudge) => {
          if (!nudge) return;
          if (this.noticeTimer) clearTimeout(this.noticeTimer);
          notice?.setProperties({ text: panelText(nudge.text), color: NOTICE.nudge, borderColor: NOTICE.nudge });
          play('nudge');
        }),
      );
    }
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

    const xrButton = element('xr-button');
    const exitButton = element('exit-button');
    const buttons: Record<string, { element: UIKit.Text | null; base: string; action: () => void }> = {
      // Intent chips: the AI ones open a plan to review; Focus 25 and Clear done act at once (no AI needed).
      plan: { element: element('plan-button'), base: BUTTON.primary, action: () => void this.world.getSystem(AgentSystem)?.run('plan_my_day') },
      prioritise: { element: element('prioritise-button'), base: BUTTON.primary, action: () => void this.world.getSystem(AgentSystem)?.run('prioritise') },
      log: { element: element('log-button'), base: BUTTON.base, action: () => this.world.getSystem(AgentSystem)?.openLog() },
      // The notice line is a control too: a nudge goes to the agent, otherwise it explains what the AI last did.
      notice: {
        element: notice,
        base: NOTICE.base,
        action: () => {
          const agent = this.world.getSystem(AgentSystem);
          if (!agent?.acceptNudge()) agent?.openLog();
        },
      },
      arrange: { element: element('arrange-button'), base: BUTTON.base, action: () => this.bringToMe() },
      focus: { element: element('focus-button'), base: BUTTON.base, action: () => this.focus25() },
      undo: { element: element('undo-button'), base: BUTTON.base, action: () => workspace.undo() && play('undo') },
      // Settings: each toggle shows its state as its colour (blue = on).
      contrast: { element: element('contrast-button'), base: BUTTON.base, action: () => toggleSetting('highContrast') },
      sound: { element: element('sound-button'), base: BUTTON.base, action: () => toggleSetting('sound') },
      voice: { element: element('voice-button'), base: BUTTON.base, action: () => toggleSetting('readAloud') },
      clear: {
        element: element('clear-button'),
        base: BUTTON.base,
        action: () => workspace.dispatch({ op: 'clear_done' }, { notice: 'Cleared the last column of every board.' }),
      },
      xr: { element: xrButton, base: BUTTON.primary, action: () => this.world.launchXR() },
      exit: { element: exitButton, base: BUTTON.base, action: () => this.world.exitXR() },
    };
    if (root) {
      // One listener on the panel root (see PanelHits); hover painted by hand (a UIKitML :hover style sticks).
      const controls = Object.entries(buttons).flatMap(([key, b]) => (b.element ? [[key, b.element] as const] : []));
      new PanelHits(root, controls, {
        click: (key) => buttons[key].action(),
        hover: (key, hovered) =>
          buttons[key].element?.setProperties({ borderColor: hovered ? BUTTON.hover : key === commandHighlight ? COACH_BORDER : idleBorder(buttons[key].base) }),
      }, this.cleanupFuncs);
      const toggles: [keyof Settings, string][] = [['highContrast', 'contrast'], ['sound', 'sound'], ['readAloud', 'voice']];
      const paint = () => {
        for (const [key, b] of Object.entries(buttons)) if (key !== 'notice') b.element?.setProperties({ borderColor: key === commandHighlight ? COACH_BORDER : idleBorder(b.base) });
        for (const [setting, key] of toggles) buttons[key].element?.setProperties({ backgroundColor: settings[setting] ? BUTTON.primary : BUTTON.base });
      };
      paint();
      this.cleanupFuncs.push(onSettings(paint));
      repaintCommand = paint;
      this.cleanupFuncs.push(() => (repaintCommand = null));
    }

    if (!this.world.xrEnabled) {
      xrButton?.setProperties({ display: 'none' });
      exitButton?.setProperties({ display: 'none' });
      return;
    }
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

  /** What a press on this panel arranges around: the user is looking at the panel then, not ahead (viewer.ts). */
  private deskPose(): Pose {
    return deskPose(this.world);
  }

  private bringToMe(): void {
    workspace.dispatch({ op: 'arrange_space', layout: 'desk' }, { viewer: this.deskPose(), notice: 'Everything is back around you.' });
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
        viewer: this.deskPose(),
        label: 'focus 25',
        notice: card ? `Focus 25 on "${panelText(card.title)}". The other boards stepped back.` : 'Focus 25 started. The other boards stepped back.',
      },
    );
  }

  private reanchorIfFar(): void {
    const viewer = viewerPose(this.world);
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

  private showNotice(notice: Notice, element: UIKit.Text | null): void {
    (window as unknown as { __notice: Notice }).__notice = notice; // read by the Playwright tests
    element?.setProperties({ text: panelText(notice.text), color: notice.error ? TEXT.error : TEXT.normal, borderColor: NOTICE.base });
    if (notice.error) play('error');
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
