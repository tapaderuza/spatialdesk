/**
 * The agent in the room, on one card half a metre in front of the user:
 *  - a plan to review (from the intent chips): each step with its reason, Apply as one batch, or Discard;
 *  - a suggestion it makes on its own when a timer ends (shown only once it is ready, never as an error);
 *  - "what the AI did": the latest applied plans, each step with its reason and its own Undo.
 * It also watches the workspace every 30 s (src/agent/watcher.ts) and raises nudges on the command panel; it never
 * changes anything without the user's tap. The source of every plan is shown: Amazon Nova or the built-in planner.
 */
import {
  createSystem,
  Group,
  PanelDocument,
  PanelUI,
  PokeInteractable,
  RayInteractable,
  type Entity,
  type Object3D,
  type UIKit,
  type UIKitDocument,
} from '@iwsdk/core';
import { Workspaces } from 'spatialdesk-shared';
import { PanelHits } from '../ui/panel-hits.js';
import { idleBorder, onSettings, settings } from '../ui/settings.js';
import { play } from '../ui/sounds.js';
import { AgentPanel } from '../workspace/components.js';
import { panelText, type Pose, type Timer } from '../workspace/model.js';
import { workspace, type AgentAction } from '../workspace/store.js';
import { timerFinishedListeners } from '../workspace/timers.js';
import { deskPose } from '../workspace/viewer.js';
import { describeStep, requestPlan, sourceLabel, type AgentPlan, type Intent } from './client.js';
import { dayText, installDayInput } from './day-input.js';
import { findNudge, timerContext, type Nudge } from './watcher.js';

const engine = Workspaces.getInstance();
const CONFIG = `${import.meta.env.BASE_URL}ui/plan.uikitml`;
const SIZE = { width: 0.46, height: 0.55 } as const; // public/ui/plan.uikitml is 46 x 55 cm
const STEP_ROWS = 4;
const WATCH_EVERY_MS = 30_000;
const TITLES: Record<Intent, string> = {
  plan_my_day: 'Plan my day',
  prioritise: 'Prioritise',
  focus: 'Focus',
  clear_done: 'Clear done',
  summarise: 'Summary',
  custom: 'Your request',
  next_block: 'Next block',
  replan: 'Re-plan',
  regroup: 'Regroup boards',
};
const COLOR = { base: '#2a313b', primary: '#2f5f9e', hover: '#9cc3ff', text: '#eef1f5', dim: '#8b95a3', error: '#ff8a7a' } as const;

type Mode = 'idle' | 'thinking' | 'preview' | 'suggestion' | 'log' | 'error';
type Element = UIKit.Text;
type Key = 'apply' | 'discard' | 'undo-0' | 'undo-1' | 'undo-2' | 'undo-3';

interface Slots {
  title: Element;
  source: Element;
  summary: Element;
  steps: { box: Element; title: Element; why: Element; undo: Element; undoLabel: Element }[];
  note: Element;
  apply: Element;
  applyLabel: Element;
  discard: Element;
  discardLabel: Element;
}

export class AgentSystem extends createSystem({ ready: { required: [AgentPanel, PanelDocument] } }) {
  private entity!: Entity;
  private slots: Slots | null = null;
  private mode: Mode = 'idle';
  /** Thinking for a suggestion the user did not ask for: the card stays hidden until there is something to show. */
  private quiet = false;
  private plan: AgentPlan | null = null;
  private intent: Intent = 'plan_my_day';
  private action: AgentAction | null = null;
  private nudge: Nudge | null = null;
  private readonly seen = new Set<string>();
  private readonly nudgeListeners = new Set<(nudge: Nudge | null) => void>();
  private readonly runningSince = Date.now();
  private nextWatch = 0;
  private startedAt = 0;
  private shownTenths = -1;
  private readonly cleanups: (() => void)[] = [];
  /** performance.now() marks, read by the "plan my day in < 4 s" end-to-end test. */
  readonly timings = { requested: 0, previewed: 0, applied: 0 };

  init(): void {
    this.entity = this.world.createTransformEntity(new Group());
    this.entity.object3D!.rotation.order = 'YXZ';
    this.entity.addComponent(PanelUI, { config: CONFIG });
    this.entity.addComponent(RayInteractable);
    this.entity.addComponent(PokeInteractable);
    this.entity.addComponent(AgentPanel);
    this.setVisible(false);
    this.queries.ready.subscribe('qualify', (entity) => {
      const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
      if (!document || this.slots) return;
      document.setTargetDimensions(SIZE.width, SIZE.height);
      this.slots = this.bind(document);
      this.render();
    });
    const onTimer = (timer: Timer) => this.timerFinished(timer);
    timerFinishedListeners.add(onTimer);
    this.cleanupFuncs.push(() => timerFinishedListeners.delete(onTimer));
    // Plans undone from elsewhere (the Undo button) change what "what the AI did" shows.
    this.cleanupFuncs.push(workspace.subscribe(() => this.mode === 'log' && this.refreshLog()));
    this.cleanupFuncs.push(installDayInput(this.world, () => void this.run('plan_my_day')));
    this.cleanupFuncs.push(onSettings(() => this.render()));
    this.cleanupFuncs.push(() => this.cleanups.forEach((cleanup) => cleanup()));
    (window as unknown as { __agent: AgentSystem }).__agent = this; // driven by the Playwright tests
  }

  get state(): { phase: Mode; plan: AgentPlan | null; nudge: Nudge | null; action: AgentAction | null } {
    return { phase: this.mode, plan: this.plan, nudge: this.nudge, action: this.action };
  }

  onNudge(listener: (nudge: Nudge | null) => void): () => void {
    this.nudgeListeners.add(listener);
    return () => this.nudgeListeners.delete(listener);
  }

  /**
   * Asks the agent. With [auto] (the agent's own suggestion) the card appears only when there is a plan worth
   * showing; a failure then is a quiet notice, not an error card in the user's face.
   */
  async run(intent: Intent, text: string = dayText(), options: { context?: string; auto?: boolean } = {}): Promise<void> {
    if (this.mode === 'thinking') return;
    this.intent = intent;
    this.plan = null;
    this.mode = 'thinking';
    this.quiet = options.auto === true;
    this.startedAt = this.timings.requested = performance.now();
    this.shownTenths = -1;
    if (!this.quiet) this.show();
    const plan = await requestPlan(intent, text, workspace.state, deskPose(this.world), options.context);
    if (this.mode !== 'thinking') return; // closed while waiting
    this.timings.previewed = performance.now();
    if (this.quiet && (!plan.ok || plan.steps.length === 0)) {
      this.mode = 'idle';
      if (!plan.ok) workspace.notify({ text: 'The AI could not suggest a next step right now.', error: false });
      return;
    }
    this.plan = plan;
    this.mode = !plan.ok ? 'error' : this.quiet ? 'suggestion' : 'preview';
    if (this.quiet) this.show();
    this.render();
    this.speak(plan.ok ? plan.summary ?? '' : plan.error ?? '');
  }

  apply(): void {
    const plan = this.plan;
    if ((this.mode !== 'preview' && this.mode !== 'suggestion') || !plan || plan.steps.length === 0) {
      this.close();
      return;
    }
    const before = workspace.state;
    const result = workspace.dispatch(
      plan.steps.map((step) => step.op),
      {
        label: 'AI plan',
        viewer: deskPose(this.world),
        notice: `${plan.summary ?? 'Plan applied.'} Tap here to see why, or undo a step.`,
        agent: {
          intent: this.intent,
          summary: plan.summary ?? '',
          source: plan.source ?? '',
          steps: plan.steps.map((step) => ({ label: describeStep(step.op, before), why: step.why })),
        },
      },
    );
    if (!result.ok) {
      // The user moved things while the agent was thinking: the plan no longer fits, so say so plainly.
      this.plan = { ok: false, steps: [], error: `The workspace changed since this plan was made: ${result.error} Ask again.` };
      this.mode = 'error';
      this.render();
      return;
    }
    this.timings.applied = performance.now();
    play('apply');
    this.close();
  }

  /** "What the AI did": the latest applied plan, step by step, each with its own Undo. */
  openLog(): void {
    if (this.mode === 'thinking') return;
    const latest = workspace.agentActions()[0];
    if (!latest) {
      workspace.notify({ text: 'The AI has not changed anything yet.', error: false });
      return;
    }
    this.action = latest;
    this.mode = 'log';
    this.show();
    this.render();
  }

  /** The user tapped the nudge on the command panel: now the agent may think about it. */
  acceptNudge(): boolean {
    const nudge = this.nudge;
    if (!nudge) return false;
    this.setNudge(null);
    void this.run(nudge.intent, '', { context: nudge.context });
    return true;
  }

  close(): void {
    this.mode = 'idle';
    this.quiet = false;
    this.setVisible(false);
  }

  update(): void {
    if (this.mode === 'thinking' && !this.quiet && this.slots) {
      const tenths = Math.floor((performance.now() - this.startedAt) / 100);
      if (tenths !== this.shownTenths) {
        this.shownTenths = tenths;
        this.slots.summary.setProperties({ text: `Thinking... ${(tenths / 10).toFixed(1)} s` });
      }
    }
    const now = Date.now();
    if (now < this.nextWatch) return;
    this.nextWatch = now + WATCH_EVERY_MS;
    this.watch(now);
  }

  /** One look at the workspace for something worth a nudge (every 30 s; tests pass a later clock). */
  watch(now: number): Nudge | null {
    if (this.nudge || this.mode !== 'idle') return null;
    const nudge = findNudge(workspace.state, now, this.seen, this.runningSince);
    if (nudge) {
      this.seen.add(nudge.key);
      this.setNudge(nudge);
    }
    return nudge;
  }

  /** A timer rang: after a focus block the agent suggests the next one; after a break, getting back to work. */
  private timerFinished(timer: Timer): void {
    if (this.mode !== 'idle') return;
    const { intent, context } = timerContext(timer, workspace.state);
    void this.run(intent, '', { context, auto: true });
  }

  /** Reads the agent's words aloud when the user asked for it; the card always shows the same words as text. */
  private speak(text: string): void {
    if (!settings.readAloud || !text || typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  private setNudge(nudge: Nudge | null): void {
    this.nudge = nudge;
    for (const listener of this.nudgeListeners) listener(nudge);
  }

  private refreshLog(): void {
    const id = this.action?.id;
    this.action = workspace.agentActions().find((a) => a.id === id) ?? null;
    if (!this.action) this.close();
    else this.render();
  }

  private undoStep(k: number): void {
    const action = this.action;
    if (this.mode !== 'log' || !action || !action.steps[k] || action.steps[k].undone) return;
    if (workspace.undoAgentStep(action.id, k)) play('undo'); // the store's change refreshes this view
  }

  private render(): void {
    const slots = this.slots;
    if (!slots) return;
    const showUndo = this.mode === 'log';
    slots.steps.forEach((row) => row.undo.setProperties({ display: showUndo ? 'flex' : 'none', borderColor: idleBorder(COLOR.base) }));
    slots.discard.setProperties({ borderColor: idleBorder(COLOR.base) });

    if (this.mode === 'log' && this.action) {
      const a = this.action;
      const at = new Date(a.atMs);
      slots.title.setProperties({ text: 'What the AI did' });
      slots.source.setProperties({ text: panelText(`${TITLES[a.intent as Intent] ?? 'Plan'}, ${sourceLabel(a.source)}, ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`) });
      slots.summary.setProperties({ text: panelText(a.summary), color: COLOR.text });
      this.rows(a.steps.map((s) => ({ title: s.label, why: s.why, undone: s.undone })));
      const earlier = workspace.agentActions().slice(1, 3).map((x) => TITLES[x.intent as Intent] ?? 'Plan');
      const more = a.steps.length > STEP_ROWS ? `+${a.steps.length - STEP_ROWS} more steps. ` : '';
      slots.note.setProperties({ text: panelText(`${more}${earlier.length ? `Earlier: ${earlier.join(', ')}.` : 'Undo a step and anything that depended on it goes too.'}`) });
      const anyLeft = a.steps.some((s) => !s.undone);
      slots.apply.setProperties({ display: anyLeft ? 'flex' : 'none' });
      slots.applyLabel.setProperties({ text: 'Undo whole plan' });
      slots.discardLabel.setProperties({ text: 'Close' });
      return;
    }

    const plan = this.plan;
    const suggestion = this.mode === 'suggestion';
    slots.title.setProperties({ text: suggestion ? `Suggestion: ${TITLES[this.intent].toLowerCase()}` : TITLES[this.intent] });
    if (this.mode === 'thinking') {
      slots.source.setProperties({ text: 'Asking Amazon Nova' });
      slots.summary.setProperties({ text: 'Thinking...', color: COLOR.text });
      this.rows([]);
      slots.note.setProperties({ text: '' });
      slots.apply.setProperties({ display: 'none' });
      slots.discardLabel.setProperties({ text: 'Cancel' });
      return;
    }
    if (this.mode === 'error' || !plan) {
      slots.source.setProperties({ text: '' });
      slots.summary.setProperties({ text: panelText(plan?.error ?? 'Something went wrong.'), color: COLOR.error });
      this.rows([]);
      slots.note.setProperties({ text: '' });
      slots.apply.setProperties({ display: 'none' });
      slots.discardLabel.setProperties({ text: 'Close' });
      return;
    }
    const seconds = plan.latencyMs != null ? `, ${(plan.latencyMs / 1000).toFixed(1)} s` : '';
    const by = plan.source === 'built-in' ? 'Plan by the built-in planner' : `AI plan by ${sourceLabel(plan.source)}`;
    slots.source.setProperties({ text: `${by}${seconds}` });
    slots.summary.setProperties({ text: panelText(plan.summary ?? ''), color: COLOR.text });
    this.rows(plan.steps.map((s, i) => ({ title: `${i + 1}. ${describeStep(s.op, workspace.state)}`, why: s.why, undone: false })));
    const more = plan.steps.length > STEP_ROWS ? `+${plan.steps.length - STEP_ROWS} more steps. ` : '';
    slots.note.setProperties({ text: panelText(`${more}${plan.note ?? ''}`) });
    const hasSteps = plan.steps.length > 0;
    slots.apply.setProperties({ display: 'flex' });
    slots.applyLabel.setProperties({ text: hasSteps ? 'Apply' : 'OK' });
    slots.discardLabel.setProperties({ text: !hasSteps ? 'Close' : suggestion ? 'Not now' : 'Discard' });
  }

  private rows(items: { title: string; why: string; undone: boolean }[]): void {
    this.slots?.steps.forEach((row, i) => {
      const item = items[i];
      if (!item) {
        row.box.setProperties({ display: 'none' });
        return;
      }
      row.box.setProperties({ display: 'flex' });
      row.title.setProperties({ text: panelText(item.title), color: item.undone ? COLOR.dim : COLOR.text });
      row.why.setProperties({ text: panelText(item.undone ? 'Undone' : item.why) });
      row.undoLabel.setProperties({ text: item.undone ? '-' : 'Undo', color: item.undone ? COLOR.dim : COLOR.text });
    });
  }

  private bind(document: UIKitDocument): Slots {
    const get = (id: string) => {
      const element = document.querySelector(`#${id}`) as Element | null;
      if (!element) throw new Error(`plan.uikitml has no #${id}`);
      element.name = `agent:${id}`; // addressable from tests and the IWSDK CLI
      return element;
    };
    const slots: Slots = {
      title: get('plan-title'),
      source: get('plan-source'),
      summary: get('plan-summary'),
      steps: Array.from({ length: STEP_ROWS }, (_, i) => ({
        box: get(`step-${i}`),
        title: get(`step-${i}-title`),
        why: get(`step-${i}-why`),
        undo: get(`step-${i}-undo`),
        undoLabel: get(`step-${i}-undo-label`),
      })),
      note: get('plan-note'),
      apply: get('plan-apply'),
      applyLabel: get('plan-apply-label'),
      discard: get('plan-discard'),
      discardLabel: get('plan-discard-label'),
    };
    const base: Record<Key, string> = { apply: COLOR.primary, discard: COLOR.base, 'undo-0': COLOR.base, 'undo-1': COLOR.base, 'undo-2': COLOR.base, 'undo-3': COLOR.base };
    const controls: (readonly [Key, Element])[] = [
      ...slots.steps.map((row, i) => [`undo-${i}` as Key, row.undo] as const),
      ['apply', slots.apply],
      ['discard', slots.discard],
    ];
    new PanelHits(get('plan-root'), controls, {
      click: (key) => {
        if (key === 'discard') this.close();
        else if (key === 'apply') this.mode === 'log' ? this.undoWhole() : this.apply();
        else this.undoStep(Number(key.slice(5)));
      },
      hover: (key, hovered) => controls.find(([k]) => k === key)?.[1].setProperties({ borderColor: hovered ? COLOR.hover : idleBorder(base[key]) }),
    }, this.cleanups);
    return slots;
  }

  private undoWhole(): void {
    if (this.action && workspace.undoAction(this.action.id)) play('undo'); // refreshLog closes the card once nothing is left
  }

  private show(): void {
    this.place();
    this.setVisible(true);
    this.render();
  }

  /** In front of the focus board, facing the user's anchor (Layout.kt). */
  private place(): void {
    const pose = JSON.parse(engine.previewPose(JSON.stringify(workspace.state))) as Pose;
    const object = this.entity.object3D!;
    object.position.set(pose.x, pose.y, pose.z);
    object.rotation.set(pose.pitch, pose.yaw, 0);
  }

  /** Hidden means not drawn and not hit by any pointer. */
  private setVisible(visible: boolean): void {
    const object = this.entity.object3D! as Object3D & { pointerEvents?: string };
    object.visible = visible;
    object.pointerEvents = visible ? undefined : 'none'; // undefined: back to pointer-events' default (only listeners)
  }
}
