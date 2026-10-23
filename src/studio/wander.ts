/**
 * When the mind wanders: during a focus block, if the gaze stays off the work for a while, the companion calls you
 * back (src/studio/companion-system.ts): it brightens, turns to you and chimes softly from where it floats. Look back
 * and it welcomes you with a little hop; the block counts the times you came back, and says so when it ends. Coming
 * back is the skill, never a reproach: nothing is held against you, and a glance at the timer or the companion beside
 * the board is still the work.
 *
 * The gaze is the eyes where the headset tracks them (Meta VR Glasses), else the head, compared with the line to the
 * focus board a few times a second, on the headset; nothing is stored or sent but the count. Quiet while the agent's
 * card is open, in a break, outside XR, and with the "Nudges" setting off ("nudges off" by voice).
 */
import { createSystem, Vector3, VisibilityState } from '@iwsdk/core';
import { AgentSystem } from '../agent/agent-system.js';
import { settings } from '../ui/settings.js';
import { panelText, type Timer } from '../workspace/model.js';
import { TIMER_SCALE, workspace } from '../workspace/store.js';
import { timerFinishedListeners } from '../workspace/timers.js';

/** On the work: within this angle of the line to the board's centre (the timer and the companion beside it count). */
const ON_WORK_COS = Math.cos((50 * Math.PI) / 180);
/** Away this long (seconds) before the companion calls: a look out of the window to think is not wandering. */
const DRIFT_S = TIMER_SCALE < 1 ? 3 : 45;
/** Back on the work this long before it counts as coming back. */
const BACK_S = 0.4;
const TEST_EVERY_FRAMES = 6;
/** A break timer (as timers.ts names it); matched without trimming, so nothing is allocated per frame. */
const BREAK = /^\s*break\s*$/i;

export class WanderSystem extends createSystem({}) {
  private agent: AgentSystem | null = null;
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly toBoard = new Vector3();
  /** The running focus block's timer, whose comebacks are counted. */
  private block: string | null = null;
  private onWork = true;
  private awayS = 0;
  private backS = 0;
  private frame = 0;
  /** Read by the companion and the Playwright tests: [returns] counts this block's comebacks after a call. */
  readonly view = { watching: false, calling: false, returns: 0 };

  init(): void {
    this.agent = this.world.getSystem(AgentSystem) ?? null;
    (window as unknown as { __wander: WanderSystem }).__wander = this;
    const onTimer = (timer: Timer) => {
      const n = this.view.returns;
      if (timer.id !== this.block || n === 0) return;
      const times = n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
      workspace.notify({ text: `Time is up: ${panelText(timer.label)}. You came back to it ${times}.`, error: false });
    };
    timerFinishedListeners.add(onTimer);
    this.cleanupFuncs.push(() => timerFinishedListeners.delete(onTimer));
  }

  update(delta: number): void {
    const block = this.focusBlock();
    if (block !== this.block) {
      this.block = block;
      this.view.returns = 0;
      this.reset();
    }
    const watching =
      block !== null && settings.nudges && this.world.visibilityState.peek() !== VisibilityState.NonImmersive && (this.agent?.phase ?? 'idle') === 'idle';
    this.view.watching = watching;
    if (!watching) {
      if (this.view.calling || this.awayS > 0) this.reset();
      return;
    }
    if (++this.frame % TEST_EVERY_FRAMES === 0) this.onWork = this.looksAtWork();
    if (this.onWork) {
      this.awayS = 0;
      if (this.view.calling && (this.backS += delta) >= BACK_S) {
        this.view.calling = false;
        this.view.returns++;
        this.backS = 0;
      }
    } else {
      this.backS = 0;
      if (!this.view.calling && (this.awayS += delta) >= DRIFT_S) this.view.calling = true;
    }
  }

  private reset(): void {
    this.view.calling = false;
    this.onWork = true;
    this.awayS = 0;
    this.backS = 0;
  }

  /** The running focus block (not a break), if any. */
  private focusBlock(): string | null {
    const timers = workspace.state.timers;
    for (let i = 0; i < timers.length; i++) {
      if (timers[i].state === 'running' && !BREAK.test(timers[i].label)) return timers[i].id;
    }
    return null;
  }

  /** The eyes where tracked (IWSDK's gaze pose; a target ray points down its -Z), else the head, toward the board. */
  private looksAtWork(): boolean {
    const player = this.world.player;
    if (player.gazeOrigin === 'tracked') {
      player.eyeSpace.getWorldPosition(this.origin);
      player.eyeSpace.getWorldDirection(this.direction).negate();
    } else {
      this.world.camera.getWorldPosition(this.origin);
      this.world.camera.getWorldDirection(this.direction);
    }
    const ws = workspace.state;
    const boards = ws.boards;
    for (let i = 0; i < boards.length; i++) {
      if (boards[i].id !== ws.focusBoardId) continue;
      const p = boards[i].pose;
      this.toBoard.set(p.x - this.origin.x, p.y - this.origin.y, p.z - this.origin.z).normalize();
      return this.direction.dot(this.toBoard) >= ON_WORK_COS;
    }
    return true; // no board to come back to
  }
}
