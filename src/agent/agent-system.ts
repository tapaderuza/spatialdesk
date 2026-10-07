/**
 * The agent in the room: a plan card that appears half a metre in front of the user while the agent thinks, then
 * shows what it proposes, step by step with each reason and where the plan came from. Apply runs the whole plan as
 * one batch through the shared engine (one undo step); Discard leaves everything as it was.
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
import { AgentPanel } from '../workspace/components.js';
import { panelText, type Pose } from '../workspace/model.js';
import { workspace } from '../workspace/store.js';
import { viewerPose } from '../workspace/viewer.js';
import { describeStep, requestPlan, sourceLabel, type AgentPlan, type Intent } from './client.js';
import { dayText, installDayInput } from './day-input.js';

const engine = Workspaces.getInstance();
const CONFIG = `${import.meta.env.BASE_URL}ui/plan.uikitml`;
const SIZE = { width: 0.44, height: 0.5 } as const; // public/ui/plan.uikitml is 44 x 50 cm
const STEP_ROWS = 5;
const TITLES: Record<Intent, string> = {
  plan_my_day: 'Plan my day',
  prioritise: 'Prioritise',
  focus: 'Focus',
  clear_done: 'Clear done',
  summarise: 'Summary',
  custom: 'Your request',
};
const COLOR = { base: '#2a313b', primary: '#2f5f9e', hover: '#9cc3ff', text: '#eef1f5', error: '#ff8a7a' } as const;

type Phase = 'idle' | 'thinking' | 'preview' | 'error';
type Element = UIKit.Text;

interface Slots {
  title: Element;
  source: Element;
  summary: Element;
  steps: { box: Element; title: Element; why: Element }[];
  note: Element;
  apply: Element;
  applyLabel: Element;
  discardLabel: Element;
}

export class AgentSystem extends createSystem({ ready: { required: [AgentPanel, PanelDocument] } }) {
  private entity!: Entity;
  private slots: Slots | null = null;
  private phase: Phase = 'idle';
  private plan: AgentPlan | null = null;
  private intent: Intent = 'plan_my_day';
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
    this.cleanupFuncs.push(installDayInput(this.world, () => void this.run('plan_my_day')));
    this.cleanupFuncs.push(() => this.cleanups.forEach((cleanup) => cleanup()));
    (window as unknown as { __agent: AgentSystem }).__agent = this; // driven by the Playwright tests
  }

  get state(): { phase: Phase; plan: AgentPlan | null } {
    return { phase: this.phase, plan: this.plan };
  }

  /** Asks the agent; the plan card shows progress, then the proposal. Nothing changes until Apply. */
  async run(intent: Intent, text: string = dayText()): Promise<void> {
    if (this.phase === 'thinking') return;
    this.intent = intent;
    this.plan = null;
    this.phase = 'thinking';
    this.startedAt = this.timings.requested = performance.now();
    this.shownTenths = -1;
    this.place();
    this.setVisible(true);
    this.render();
    const plan = await requestPlan(intent, text, workspace.state, viewerPose(this.world));
    if (this.phase !== 'thinking') return; // closed while waiting
    this.plan = plan;
    this.phase = plan.ok ? 'preview' : 'error';
    this.timings.previewed = performance.now();
    this.render();
  }

  apply(): void {
    const plan = this.plan;
    if (this.phase !== 'preview' || !plan || plan.steps.length === 0) {
      this.close();
      return;
    }
    const result = workspace.dispatch(
      plan.steps.map((step) => step.op),
      { label: 'AI plan', viewer: viewerPose(this.world), notice: plan.summary ?? 'Plan applied.' },
    );
    if (!result.ok) {
      // The user moved things while the agent was thinking: the plan no longer fits, so say so plainly.
      this.plan = { ok: false, steps: [], error: `The workspace changed since this plan was made: ${result.error} Ask again.` };
      this.phase = 'error';
      this.render();
      return;
    }
    this.timings.applied = performance.now();
    this.close();
  }

  close(): void {
    this.phase = 'idle';
    this.setVisible(false);
  }

  update(): void {
    if (this.phase !== 'thinking' || !this.slots) return;
    const tenths = Math.floor((performance.now() - this.startedAt) / 100);
    if (tenths === this.shownTenths) return;
    this.shownTenths = tenths;
    this.slots.summary.setProperties({ text: `Thinking... ${(tenths / 10).toFixed(1)} s` });
  }

  private render(): void {
    const slots = this.slots;
    if (!slots) return;
    const plan = this.plan;
    slots.title.setProperties({ text: TITLES[this.intent] });
    if (this.phase === 'thinking') {
      slots.source.setProperties({ text: 'Asking Amazon Nova' });
      slots.summary.setProperties({ text: 'Thinking...', color: COLOR.text });
      slots.steps.forEach((row) => row.box.setProperties({ display: 'none' }));
      slots.note.setProperties({ text: '' });
      slots.apply.setProperties({ display: 'none' });
      slots.discardLabel.setProperties({ text: 'Cancel' });
      return;
    }
    if (this.phase === 'error' || !plan) {
      slots.source.setProperties({ text: '' });
      slots.summary.setProperties({ text: panelText(plan?.error ?? 'Something went wrong.'), color: COLOR.error });
      slots.steps.forEach((row) => row.box.setProperties({ display: 'none' }));
      slots.note.setProperties({ text: '' });
      slots.apply.setProperties({ display: 'none' });
      slots.discardLabel.setProperties({ text: 'Close' });
      return;
    }
    const seconds = plan.latencyMs != null ? `, ${(plan.latencyMs / 1000).toFixed(1)} s` : '';
    const by = plan.source === 'built-in' ? 'Plan by the built-in planner' : `AI plan by ${sourceLabel(plan.source)}`;
    slots.source.setProperties({ text: `${by}${seconds}` });
    slots.summary.setProperties({ text: panelText(plan.summary ?? ''), color: COLOR.text });
    slots.steps.forEach((row, i) => {
      const step = plan.steps[i];
      if (!step) {
        row.box.setProperties({ display: 'none' });
        return;
      }
      row.box.setProperties({ display: 'flex' });
      row.title.setProperties({ text: panelText(`${i + 1}. ${describeStep(step.op, workspace.state)}`) });
      row.why.setProperties({ text: panelText(step.why) });
    });
    const more = plan.steps.length > STEP_ROWS ? `+${plan.steps.length - STEP_ROWS} more steps. ` : '';
    slots.note.setProperties({ text: panelText(`${more}${plan.note ?? ''}`) });
    const hasSteps = plan.steps.length > 0;
    slots.apply.setProperties({ display: 'flex' });
    slots.applyLabel.setProperties({ text: hasSteps ? 'Apply' : 'OK' });
    slots.discardLabel.setProperties({ text: hasSteps ? 'Discard' : 'Close' });
  }

  private bind(document: UIKitDocument): Slots {
    const get = (id: string) => {
      const element = document.querySelector(`#${id}`) as Element | null;
      if (!element) throw new Error(`plan.uikitml has no #${id}`);
      element.name = `agent:${id}`; // addressable from tests and the IWSDK CLI
      return element;
    };
    const apply = get('plan-apply');
    const discard = get('plan-discard');
    const base = { apply: COLOR.primary, discard: COLOR.base } as const;
    new PanelHits(get('plan-root'), [['apply', apply], ['discard', discard]] as const, {
      click: (key) => (key === 'apply' ? this.apply() : this.close()),
      hover: (key, hovered) => (key === 'apply' ? apply : discard).setProperties({ borderColor: hovered ? COLOR.hover : base[key] }),
    }, this.cleanups);
    return {
      title: get('plan-title'),
      source: get('plan-source'),
      summary: get('plan-summary'),
      steps: Array.from({ length: STEP_ROWS }, (_, i) => ({ box: get(`step-${i}`), title: get(`step-${i}-title`), why: get(`step-${i}-why`) })),
      note: get('plan-note'),
      apply,
      applyLabel: get('plan-apply-label'),
      discardLabel: get('plan-discard-label'),
    };
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
