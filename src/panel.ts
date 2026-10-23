import { createSystem, UIKitMLAsset, VisibilityState, type UIKit } from '@iwsdk/core';
import { Workspaces } from 'spatialdesk-shared';
import { AgentSystem } from './agent/agent-system.js';
import { dayText } from './agent/day-input.js';
import { BackendLink, type LinkState } from './backend/link.js';
import { hoverFades } from './ui/hover.js';
import { PanelHits } from './ui/panel-hits.js';
import { measureView, sameView } from './ui/view-fit.js';
import { idleBorder, onSettings, settings, toggleSetting, type Settings } from './ui/settings.js';
import { play } from './ui/sounds.js';
import { heldCard, releaseHeld } from './workspace/boards.js';
import { panelText, type Pose, type Timer } from './workspace/model.js';
import { Progress, progress } from './workspace/progress.js';
import { TIMER_SCALE, workspace, type Notice } from './workspace/store.js';
import { timerFinishedListeners } from './workspace/timers.js';
import { deskPose, viewerPose } from './workspace/viewer.js';
import { inRoom, launchRoom, launchVR, RoomSystem } from './room/room-system.js';
import { parseCommand } from './voice/commands.js';
import { isListening, listen, stopListening } from './voice/listen.js';

const engine = Workspaces.getInstance();

// Status colours on the dark panel: all >= 7:1 against #15181e (ROADMAP heuristic B).
const COLORS = { online: '#5ee0a0', connecting: '#f2b84b', offline: '#ff8a7a' } as const;
const BUTTON = { base: '#2a313b', primary: '#2f5f9e' } as const;
const TEXT = { normal: '#eef1f5', dim: '#8b95a3', error: '#ff8a7a' } as const;
// The notice line: amber text and border while the agent has a nudge waiting there.
const NOTICE = { base: '#1d222a', nudge: '#f2b84b' } as const;
const COACH_BORDER = '#f2b84b';
// The seven-day strip: a focused day is green with a dark "+" (shape as well as colour), today has a light outline.
const DAY = { focused: '#5ee0a0', empty: '#2a313b', today: '#eef1f5' } as const;
const SETTING_NAMES: Record<keyof Settings, string> = { highContrast: 'High contrast', sound: 'Sound', readAloud: 'Read aloud', handsFree: 'Hands-free' };
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
  private notice: UIKit.Text | null = null;
  private talkLabel: UIKit.Text | null = null;
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
    this.notice = notice;
    this.talkLabel = element('talk-label');
    // Tests and the demo say things without a microphone: the same path from the words on.
    (window as unknown as { __voice: { say: (said: string) => void } }).__voice = { say: (said) => this.runVoice(said) };

    this.link = new BackendLink((state) => this.show(state, dot, text));
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
    // Progress between sessions: a finished focus block (not a break) and cards reaching a last column count.
    const paintProgress = this.progressPainter(element, detail);
    paintProgress();
    const onTimer = (timer: Timer) => {
      if (/^break$/i.test(timer.label.trim())) return;
      progress.recordBlock(timer.durationMs / 60_000 / TIMER_SCALE);
      paintProgress();
    };
    timerFinishedListeners.add(onTimer);
    this.cleanupFuncs.push(() => timerFinishedListeners.delete(onTimer));
    this.cleanupFuncs.push(
      workspace.subscribe((change) => {
        paintUndo();
        const done = change.source === 'user' && change.previous ? Progress.newlyDone(change.previous, change.state) : 0;
        if (done > 0) {
          progress.recordDone(done);
          paintProgress();
        }
        const before = change.previous?.anchor;
        const after = change.state.anchor;
        if (before && (before.x !== after.x || before.z !== after.z || before.yaw !== after.yaw)) this.placeFrames = 1;
      }),
    );

    const xrButton = element('xr-button');
    const roomButton = element('room-button');
    const fitButton = element('fit-button');
    const exitButton = element('exit-button');
    const buttons: Record<string, { element: UIKit.Text | null; base: string; action: () => void }> = {
      // Intent chips: the AI ones open a plan to review; Focus 25 and Clear done act at once (no AI needed).
      plan: { element: element('plan-button'), base: BUTTON.primary, action: () => void this.world.getSystem(AgentSystem)?.run('plan_my_day') },
      prioritise: { element: element('prioritise-button'), base: BUTTON.primary, action: () => void this.world.getSystem(AgentSystem)?.run('prioritise') },
      talk: { element: element('talk-button'), base: BUTTON.primary, action: () => void this.talk() },
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
      handsfree: { element: element('handsfree-button'), base: BUTTON.base, action: () => this.toggleHandsFree() },
      wrap: { element: element('wrap-button'), base: BUTTON.base, action: () => this.world.getSystem(AgentSystem)?.wrapUp() },
      xr: { element: xrButton, base: BUTTON.primary, action: () => launchVR(this.world) },
      room: { element: roomButton, base: BUTTON.primary, action: () => launchRoom(this.world) },
      fit: { element: fitButton, base: BUTTON.primary, action: () => void this.world.getSystem(RoomSystem)?.requestFit() },
      exit: { element: exitButton, base: BUTTON.base, action: () => this.world.exitXR() },
    };
    if (root) {
      // One listener on the panel root (see PanelHits); hover is a fade of the control's own colour (src/ui/hover.ts).
      const hovered = new Set<string>();
      const toggles: [keyof Settings, string][] = [['highContrast', 'contrast'], ['sound', 'sound'], ['readAloud', 'voice'], ['handsFree', 'handsfree']];
      const toggled = (key: string) => toggles.some(([setting, k]) => k === key && settings[setting]);
      const paintButton = (key: string) => {
        const b = buttons[key];
        if (!b.element) return;
        // The notice line's border is its own: amber while a nudge waits (showNotice).
        if (key !== 'notice') b.element.setProperties({ borderColor: key === commandHighlight ? COACH_BORDER : idleBorder(b.base) });
        hoverFades.paint(b.element, toggled(key) ? BUTTON.primary : b.base, hovered.has(key));
      };
      const controls = Object.entries(buttons).flatMap(([key, b]) => (b.element ? [[key, b.element] as const] : []));
      new PanelHits(root, controls, {
        click: (key) => buttons[key].action(),
        hover: (key, on) => {
          if (on) hovered.add(key);
          else hovered.delete(key);
          paintButton(key);
        },
      }, this.cleanupFuncs);
      const paint = () => {
        for (const key of Object.keys(buttons)) paintButton(key);
      };
      paint();
      this.cleanupFuncs.push(onSettings(paint));
      repaintCommand = paint;
      this.cleanupFuncs.push(() => (repaintCommand = null));
    }

    if (!this.world.xrEnabled) {
      for (const button of [xrButton, roomButton, fitButton, exitButton]) button?.setProperties({ display: 'none' });
      return;
    }
    // "In my room" only where the browser can show passthrough.
    let roomSupported = true;
    void navigator.xr?.isSessionSupported('immersive-ar').then((supported) => {
      roomSupported = supported;
      if (!supported) roomButton?.setProperties({ display: 'none' });
    });
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton?.setProperties({ display: is2D ? 'flex' : 'none' });
        roomButton?.setProperties({ display: is2D && roomSupported ? 'flex' : 'none' });
        fitButton?.setProperties({ display: !is2D && inRoom(this.world) ? 'flex' : 'none' });
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

  /**
   * Talk: one spoken command (src/voice). The notice line shows the words as they are heard, then what was done;
   * pressing Talk again while listening stops early. Works with a tap, a pinch, or a held gaze (hands-free).
   */
  async talk(): Promise<void> {
    if (isListening()) {
      stopListening();
      return;
    }
    this.talkLabel?.setProperties({ text: 'Stop' });
    this.showNotice({ text: 'Listening: say a command, or what you want the AI to do.', error: false }, this.notice, false);
    play('listen');
    const result = await listen({ partial: (text) => this.showNotice({ text: `"${text}"`, error: false }, this.notice, false) });
    this.talkLabel?.setProperties({ text: 'Talk' });
    if (result.ok) this.runVoice(result.text);
    else this.showNotice({ text: result.error, error: result.error !== 'Stopped.' }, this.notice);
  }

  /** Does what the words ask (src/voice/commands.ts); requests the buttons cannot express go to the agent. */
  runVoice(said: string): void {
    const command = parseCommand(said);
    (window as unknown as { __heard: unknown }).__heard = { said, command }; // read by the Playwright tests
    const agent = this.world.getSystem(AgentSystem);
    const heard = `Heard "${said.replace(/[.!?]+$/, '')}".`;
    const tell = (text: string, error = false) => this.showNotice({ text: `${heard} ${text}`, error }, this.notice);
    if (!command) {
      tell("Say a button's name, like Focus or Undo, or what you want the AI to do.", true);
      return;
    }
    switch (command.kind) {
      case 'plan':
        tell('Planning your day.');
        void agent?.run('plan_my_day', command.text || dayText());
        return;
      case 'ask':
        tell('Asking the AI.');
        void agent?.run('custom', command.text);
        return;
      case 'prioritise':
        tell('Prioritising.');
        void agent?.run('prioritise');
        return;
      case 'apply':
        if (!agent?.acceptByVoice()) tell('There is no plan to apply right now.', true);
        return;
      case 'discard':
        if (!agent?.dismiss()) tell('There is nothing open to close.', true);
        return;
      case 'undo':
        if (workspace.undo()) play('undo');
        else tell('There is nothing to undo.', true);
        return;
      case 'focus':
        this.focus25();
        return;
      case 'arrange':
        this.bringToMe();
        return;
      case 'clear':
        workspace.dispatch({ op: 'clear_done' }, { notice: 'Cleared the last column of every board.' });
        return;
      case 'log':
        agent?.openLog();
        return;
      case 'exit':
        void this.world.exitXR();
        return;
      case 'fit':
        this.world.getSystem(RoomSystem)?.requestFit();
        return;
      case 'wrapup':
        tell('Wrapping up your day.');
        agent?.wrapUp();
        return;
      case 'setting':
        if (command.setting === 'handsFree') this.toggleHandsFree(command.value);
        else {
          toggleSetting(command.setting, command.value);
          tell(`${SETTING_NAMES[command.setting]} ${settings[command.setting] ? 'on' : 'off'}.`);
        }
        return;
    }
  }

  /** Hands-free (src/ui/gaze.ts) says how it works when it turns on: nothing on screen would tell a first-time user. */
  toggleHandsFree(value?: boolean): void {
    toggleSetting('handsFree', value);
    workspace.notify({
      text: settings.handsFree ? 'Hands-free on: look at a button and hold your gaze until the ring fills.' : 'Hands-free off.',
      error: false,
    });
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

  /**
   * The headset's own view (src/ui/view-fit.ts), once the session has started: a different one refits the layout, so
   * the board, its timer and the agent's card stay inside it (Layout.kt). Said aloud only when the panels shrank.
   */
  private fitView(): void {
    const view = measureView(this.world.renderer.xr.getFrame(), this.world.renderer.xr.getReferenceSpace());
    (window as unknown as { __view: unknown }).__view = view; // read by the Playwright tests
    if (!view || sameView(workspace.state.view, view)) return;
    const result = workspace.dispatch({ op: 'set_view', view }, { undoable: false });
    if (result.ok && workspace.panelScale < 0.995) {
      workspace.notify({
        text: `Fitted to this headset's view: your board, timer and plans stay within ${Math.round(view.halfWidthDeg * 2)} x ${Math.round(view.upDeg + view.downDeg)} degrees.`,
        error: false,
      });
    }
  }

  private reanchorIfFar(): void {
    this.fitView();
    // In the room, a remembered layout is restored to its real place (RoomSystem): never rearranged around the head.
    if (inRoom(this.world) && this.world.getSystem(RoomSystem)?.remembers) {
      this.placeFrames = 1;
      return;
    }
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
    object.scale.setScalar(workspace.panelScale); // as every panel: smaller in a narrower view (Layout.kt)
  }

  /** [fade]: back to the idle hint after a while; false while something is still going on (listening). */
  private showNotice(notice: Notice, element: UIKit.Text | null, fade = true): void {
    (window as unknown as { __notice: Notice }).__notice = notice; // read by the Playwright tests
    element?.setProperties({ text: panelText(notice.text), color: notice.error ? TEXT.error : TEXT.normal, borderColor: NOTICE.base });
    if (notice.error) play('error');
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = fade ? setTimeout(() => this.idleNotice(element), NOTICE_MS) : null;
  }

  /** Back to the hint, or to the agent's nudge if one is still waiting (another notice may have covered it). */
  private idleNotice(element: UIKit.Text | null): void {
    const nudge = this.world.getSystem(AgentSystem)?.state.nudge;
    element?.setProperties(nudge ? { text: panelText(nudge.text), color: NOTICE.nudge, borderColor: NOTICE.nudge } : { text: IDLE_NOTICE, color: TEXT.dim });
  }

  /** The connection in one line (the line below it is the user's progress, see progressPainter). */
  private show(state: LinkState, dot?: UIKit.Text | null, text?: UIKit.Text | null): void {
    (window as unknown as { __link: LinkState }).__link = state; // read by the end-to-end smoke test
    switch (state.kind) {
      case 'online':
        dot?.setProperties({ backgroundColor: COLORS.online });
        text?.setProperties({ text: 'Command server online' });
        break;
      case 'connecting':
        dot?.setProperties({ backgroundColor: COLORS.connecting });
        text?.setProperties({ text: 'Connecting to the command server...' });
        break;
      case 'offline':
        dot?.setProperties({ backgroundColor: COLORS.offline });
        text?.setProperties({ text: 'Offline - your workspace keeps working' });
        break;
    }
  }

  /** The "today" line and the seven-day strip, today last: a day with a focus block is filled and marked "+". */
  private progressPainter(element: (id: string) => UIKit.Text | null, detail: UIKit.Text | null): () => void {
    const days = Array.from({ length: 7 }, (_, i) => ({ box: element(`day-${i}`), mark: element(`day-${i}-mark`) }));
    return () => {
      detail?.setProperties({ text: progress.summary() });
      progress.week().forEach((focused, i) => {
        days[i].box?.setProperties({ backgroundColor: focused ? DAY.focused : DAY.empty, borderColor: i === 6 ? DAY.today : focused ? DAY.focused : DAY.empty });
        days[i].mark?.setProperties({ text: focused ? '+' : ' ' });
      });
    };
  }
}
