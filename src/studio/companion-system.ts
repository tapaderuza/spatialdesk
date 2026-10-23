/**
 * The focus companion (src/scene-assets/focus-companion): a body double for the user, and the agent's presence in the
 * space. Working beside someone helps people whose attention wanders start and keep going (in VR too: "You Are Not
 * Alone", arXiv 2509.12153, with human and AI body doubles). It floats just past the top corner of the board you work
 * on, in VR, in your room and in any view, and says it all without a word:
 *  - idle: a slow breath, looking at you;
 *  - focus: it works with you, its gaze on the board, the time left in the block round its middle;
 *  - calling: your gaze wandered off the work during a block (src/studio/wander.ts): warmer and brighter, looking at
 *    you with a gentle bob and a soft call from where it floats; when you look back, a hop and a welcome;
 *  - thinking: a quick shimmer while the agent plans;
 *  - something to say (a plan or a suggestion on the card): brighter, looking at you;
 *  - a break: calm green; a day wrapped up: a sleepy glow;
 *  - a focus block done: a little hop and a golden flash, as the plant grows its leaf.
 * Per frame: a few uniforms eased toward the mood and one timer's arithmetic, without allocating.
 */
import { Color, createSystem, Object3D, Vector3, type Mesh, type ShaderMaterial } from '@iwsdk/core';
import { AgentSystem } from '../agent/agent-system.js';
import { createCompanionMaterial } from '../scene-assets/focus-companion.scene-asset.js';
import { play } from '../ui/sounds.js';
import { WanderSystem } from './wander.js';
import type { Timer } from '../workspace/model.js';
import { progress } from '../workspace/progress.js';
import { workspace } from '../workspace/store.js';
import { timerFinishedListeners } from '../workspace/timers.js';

export type Mood = 'idle' | 'focus' | 'calling' | 'thinking' | 'speaking' | 'break' | 'night';

interface Look {
  core: Color;
  rim: Color;
  pulse: number;
  speed: number;
  eye: number;
  gaze: Vector3;
  dim: number;
}

const look = (core: string, rim: string, pulse: number, speed: number, eye: number, gaze: [number, number, number], dim = 1): Look => ({
  core: new Color(core),
  rim: new Color(rim),
  pulse,
  speed,
  eye,
  gaze: new Vector3(...gaze).normalize(),
  dim,
});

// Gaze directions in the companion's frame: +Z toward the user, the board to its -X.
const MOODS: Record<Mood, Look> = {
  idle: look('#dce9ff', '#6fa8ff', 0.15, 1 / 6, 0.35, [0, 0.1, 1]),
  focus: look('#fff1d6', '#ffb35c', 0.08, 1 / 8, 0.3, [-0.85, -0.25, 0.45]),
  calling: look('#fff6dc', '#ffc04d', 0.45, 1, 0.95, [0, 0.1, 1], 1.45),
  thinking: look('#ece4ff', '#8f6bff', 0.35, 1.2, 0.15, [0, 1, 0.3]),
  speaking: look('#f4f8ff', '#7fb6ff', 0.25, 0.8, 0.9, [0, 0.1, 1], 1.15),
  break: look('#e6fff0', '#5ee0a0', 0.2, 1 / 10, 0.3, [0, 0.1, 1]),
  night: look('#c3cde6', '#5a6f9e', 0.1, 1 / 12, 0.05, [0, -0.6, 0.8], 0.55),
};

/** Where it floats, in the focus board's frame at scale 1: past the board's right edge, near its top, a little nearer. */
const BESIDE_BOARD = new Vector3(0.36 + 0.1, 0.18, 0.04);
const EASE_PER_S = 3;
const CELEBRATE_MS = 900;
/** The plant grows its leaf this long after the chime (studio-system.ts): the companion hops with it. */
const CELEBRATE_DELAY_MS = 1500;
const WRAPPED_CHECK_FRAMES = 120;
/** While calling: a gentle bob (a share of the hop), about one a second. */
const CALL_BOB = 0.3;
const CALL_BOB_RATE = 5;
/** A break timer (as timers.ts names it); matched without trimming, so nothing is allocated per frame. */
const BREAK = /^\s*break\s*$/i;

export class CompanionSystem extends createSystem({}) {
  private mesh: Mesh | null = null;
  private material: ShaderMaterial | null = null;
  private agent: AgentSystem | null = null;
  private wander: WanderSystem | null = null;
  private wasCalling = false;
  private seenReturns = 0;
  private readonly helper = new Object3D();
  private readonly offset = new Vector3();
  private readonly eye = new Vector3();
  private placedFor = '';
  private celebrateAt = -Infinity;
  private wrapped = false;
  private frame = 0;
  private lastTime = -1;
  /** Read by the Playwright tests. */
  readonly view = { mood: 'idle' as Mood, progress: -1, visible: false };

  init(): void {
    const object = this.world.getSceneObject('focus-companion');
    object?.traverse((o) => {
      if (!this.mesh && (o as Mesh).isMesh) this.mesh = o as Mesh;
    });
    if (this.mesh) {
      // The prototype's material is shared: this companion gets its own to drive.
      this.material = createCompanionMaterial();
      this.mesh.material = this.material;
    }
    this.agent = this.world.getSystem(AgentSystem) ?? null;
    this.wander = this.world.getSystem(WanderSystem) ?? null;
    this.wrapped = progress.wrappedUp();
    (window as unknown as { __companion: CompanionSystem }).__companion = this;

    const onTimer = (timer: Timer) => {
      if (!BREAK.test(timer.label)) this.celebrateAt = performance.now() + CELEBRATE_DELAY_MS;
    };
    timerFinishedListeners.add(onTimer);
    this.cleanupFuncs.push(
      () => timerFinishedListeners.delete(onTimer),
      workspace.subscribe(() => this.place()),
      this.world.visibilityState.subscribe(() => this.place()),
    );
    this.place();
  }

  update(_delta: number, time: number): void {
    const material = this.material;
    if (!material || !this.view.visible) return;
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, time - this.lastTime);
    this.lastTime = time;
    if (++this.frame % WRAPPED_CHECK_FRAMES === 0) this.wrapped = progress.wrappedUp();
    const mood = this.mood();
    this.view.mood = mood;

    const target = MOODS[mood];
    const k = 1 - Math.exp(-dt * EASE_PER_S);
    const u = material.uniforms;
    (u.uCore.value as Color).lerp(target.core, k);
    (u.uRim.value as Color).lerp(target.rim, k);
    (u.uEyeDir.value as Vector3).lerp(target.gaze, k);
    u.uPulse.value += (target.pulse - u.uPulse.value) * k;
    u.uSpeed.value += (target.speed - u.uSpeed.value) * k;
    u.uEye.value += (target.eye - u.uEye.value) * k;
    u.uDim.value += (target.dim - u.uDim.value) * k;
    u.uTime.value = time;
    u.uProgress.value = this.view.progress;

    // A wandering mind: a soft call from where it floats, then a hop and a welcome when the gaze comes back.
    const calling = mood === 'calling';
    if (calling !== this.wasCalling) {
      this.wasCalling = calling;
      if (calling) play('call', this.mesh!.position);
    }
    const returns = this.wander?.view.returns ?? 0;
    if (returns > this.seenReturns) {
      this.celebrateAt = performance.now();
      play('welcome', this.mesh!.position);
    }
    this.seenReturns = returns;

    const t = (performance.now() - this.celebrateAt) / CELEBRATE_MS;
    const celebrating = t > 0 && t < 1;
    u.uBounce.value = celebrating ? Math.sin(Math.PI * t) : calling ? CALL_BOB * Math.max(0, Math.sin(time * CALL_BOB_RATE)) : 0;
    u.uFlash.value = celebrating ? 0.6 * (1 - t) : 0;
  }

  /** What the companion shows now: the agent first (it is the agent's presence), then the running block, then the day. */
  private mood(): Mood {
    const phase = this.agent?.phase;
    this.view.progress = -1;
    if (phase === 'thinking') return 'thinking';
    if (phase === 'preview' || phase === 'suggestion' || phase === 'error') return 'speaking';
    const now = Date.now();
    const timers = workspace.state.timers;
    for (let i = 0; i < timers.length; i++) {
      const timer = timers[i];
      if (timer.state !== 'running' || timer.endsAtMs == null) continue;
      if (BREAK.test(timer.label)) return 'break';
      this.view.progress = Math.max(0, Math.min(1, (timer.endsAtMs - now) / timer.durationMs));
      return this.wander?.view.calling ? 'calling' : 'focus';
    }
    return this.wrapped ? 'night' : 'idle';
  }

  /** Beside the focus board, wherever it stands (its slot, the real desk, a spot the user chose), facing the user. */
  private place(): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const ws = workspace.state;
    const board = ws.boards.find((b) => b.id === ws.focusBoardId);
    this.view.visible = board != null;
    mesh.visible = this.view.visible;
    if (!board || !this.view.visible) return;
    const p = board.pose;
    const s = workspace.panelScale;
    const key = [p.x, p.y, p.z, p.yaw, p.pitch, s].join();
    if (key === this.placedFor) return;
    this.placedFor = key;
    this.helper.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    this.offset.copy(BESIDE_BOARD).multiplyScalar(s).applyEuler(this.helper.rotation);
    mesh.position.set(p.x + this.offset.x, p.y + this.offset.y, p.z + this.offset.z);
    this.world.camera.getWorldPosition(this.eye);
    mesh.rotation.set(0, Math.atan2(this.eye.x - mesh.position.x, this.eye.z - mesh.position.z), 0);
  }
}
