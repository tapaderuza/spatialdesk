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
  RayInteractable,
  type Entity,
  type Object3D,
  type UIKit,
  type UIKitDocument,
} from '@iwsdk/core';
import { Workspaces } from 'spatialdesk-shared';
import { hoverFades } from '../ui/hover.js';
import { PanelHits } from '../ui/panel-hits.js';
import { idleBorder, onSettings, settings } from '../ui/settings.js';
import { play } from '../ui/sounds.js';
import { AgentPanel } from '../workspace/components.js';
import { panelText, type Pose, type Timer } from '../workspace/model.js';
import { workspace, type AgentAction } from '../workspace/store.js';
import { timerFinishedListeners } from '../workspace/timers.js';
import { deskPose } from '../workspace/viewer.js';
import { inRoom } from '../room/room-system.js';
import { describeStep, requestPlan, sourceLabel, type AgentPlan, type Intent } from './client.js';
import { dayText, installDayInput } from './day-input.js';
import { Conversation } from './conversation.js';
import { readComfortMemory, saveComfortMemory, forgetComfortMemory } from './comfort-memory.js';
import { DEFAULT_SESSION, type Energy, type SessionChoice } from './session-input.js';
import { accessPreferences, onAccessPreferences } from '../accessibility/preferences.js';
import { claimPanel, onPanelClaim } from '../accessibility/panel-focus.js';
import { forgetResumeNote, nextStepText, readResumeNote, resumeContext, returnTasks, saveResumeNote, type ResumeNote } from './resume-note.js';
import { progress } from '../workspace/progress.js';
import { isListening, stopListening } from '../voice/listen.js';
import { language as appLanguage } from '../i18n/language.js';
import { manualModeNotice } from '../backend/resilience.js';
import { requestSetup } from '../onboarding/setup-state.js';
import { dayEndNudge, dayStartNudge, findNudge, timerContext, wrapUpContext, type Nudge } from './watcher.js';

const engine = Workspaces.getInstance();
const CONFIG = `${import.meta.env.BASE_URL}ui/plan.uikitml`;
const SIZE = { width: 0.46, height: 0.55 } as const; // public/ui/plan.uikitml is 46 x 55 cm
const STEP_ROWS = 4;
const WATCH_EVERY_MS = 30_000;
/** While Nova thinks: the orb's core swells and settles once every BREATH_MS, and a ring of light rises from it and
 * fades every RIPPLE_MS. Slow enough to calm, quick enough that a second and a half shows it alive. */
const BREATH_MS = 1600;
const RIPPLE_MS = 1200;
const TITLES: Record<Intent, string> = {
  plan_my_day: 'Plan my day',
  prioritise: 'Prioritise',
  focus: 'Focus',
  clear_done: 'Clear done',
  summarise: 'Summary',
  custom: 'Your request',
  companion: 'Your companion',
  session: 'Your next session',
  next_block: 'Next block',
  replan: 'Re-plan',
  regroup: 'Regroup boards',
  wrap_up: 'Wrap up your day',
  comfort: 'Your space, adapted to you',
  first_step: 'A first step',
};
const COLOR = { base: '#2a313b', primary: '#2f5f9e', hover: '#9cc3ff', text: '#eef1f5', dim: '#8b95a3', error: '#ff8a7a' } as const;

export type Mode = 'idle' | 'thinking' | 'preview' | 'suggestion' | 'log' | 'error' | 'memory' | 'session' | 'resume';
type Element = UIKit.Text;
type Key = 'apply' | 'discard' | 'reply' | 'forget' | 'restore-setup' | 'forget-setup' | 'session-return' | 'return-task' | 'return-note' | 'return-forget' | 'session-5' | 'session-15' | 'session-25' | 'energy-low' | 'energy-steady' | 'undo-0' | 'undo-1' | 'undo-2' | 'undo-3';

interface Slots {
  title: Element;
  source: Element;
  summary: Element;
  /** The orb that breathes beside the summary while Nova thinks: a ring of light (halo) round a core. */
  thinking: Element;
  halo: Element;
  core: Element;
  stepList: Element;
  conversation: Element;
  said: Element;
  memory: Element;
  forgetLabel: Element;
  forget: Element;
  profileControls: Element;
  restoreLabel: Element;
  forgetSetupLabel: Element;
  sessionControls: Element;
  budgets: Element[];
  budgetLabels: Element[];
  energies: Element[];
  energyLabels: Element[];
  returnControls: Element;
  returnEditControls: Element;
  returnForget: Element;
  returnTaskLabel: Element;
  returnNoteLabel: Element;
  returnForgetLabel: Element;
  sessionReturnLabel: Element;
  steps: { box: Element; title: Element; why: Element; undo: Element; undoLabel: Element }[];
  note: Element;
  apply: Element;
  applyLabel: Element;
  discard: Element;
  discardLabel: Element;
  reply: Element;
  replyLabel: Element;
}

export class AgentSystem extends createSystem({ ready: { required: [AgentPanel, PanelDocument] } }) {
  private entity!: Entity;
  private slots: Slots | null = null;
  private mode: Mode = 'idle';
  /** Thinking for a suggestion the user did not ask for: the card stays hidden until there is something to show. */
  private quiet = false;
  private plan: AgentPlan | null = null;
  private readonly conversation = new Conversation();
  private requestId = 0;
  private dialogueTurn = false;
  private said = '';
  private replyHandler: (() => void) | null = null;
  private conversationEpoch = 0;
  private checkingComfort = false;
  private savedSetupPlan = false;
  private sessionChoice: SessionChoice = { ...DEFAULT_SESSION };
  private sessionComplete = false;
  private sessionTarget: { card: string; board: string } | null = null;
  private returnDraft: { cardId: string; nextStep: string } | null = null;
  private returnStage: 'edit' | 'saved' = 'edit';
  private returnEpoch = 0;
  private returnDictating = false;
  private returnPlan: { note: ResumeNote; boardId: string; timerId?: string } | null = null;
  private intent: Intent = 'plan_my_day';
  private action: AgentAction | null = null;
  private nudge: Nudge | null = null;
  private readonly seen = new Set<string>();
  private readonly nudgeListeners = new Set<(nudge: Nudge | null) => void>();
  private readonly runningSince = Date.now();
  private nextWatch = 0;
  private startedAt = 0;
  /** The thinking orb as last drawn (scales relative to the card, the halo's opacity): read by the tests. */
  readonly orb = { halo: 0, core: 0, glow: 0 };
  private readonly cleanups: (() => void)[] = [];
  private readonly stateListeners = new Set<() => void>();
  private localPlanGuard: (() => boolean) | null = null;
  /** performance.now() marks, read by the "plan my day in < 4 s" end-to-end test. */
  readonly timings = { requested: 0, previewed: 0, applied: 0 };

  init(): void {
    this.entity = this.world.createTransformEntity(new Group());
    this.entity.object3D!.rotation.order = 'YXZ';
    this.entity.addComponent(PanelUI, { config: CONFIG });
    this.entity.addComponent(RayInteractable);
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
    this.cleanupFuncs.push(workspace.subscribe((change) => {
      if (this.mode === 'log') this.refreshLog();
      else if (this.mode === 'resume') this.render();
      // Undo or a manual adjustment invalidates the check-in's "applied" status.
      else if (this.checkingComfort && change.previous && JSON.stringify(change.previous.comfort) !== JSON.stringify(change.state.comfort)) this.close();
    }));
    this.cleanupFuncs.push(installDayInput(this.world, () => void this.run('plan_my_day')));
    this.cleanupFuncs.push(onSettings(() => this.render()));
    this.cleanupFuncs.push(onAccessPreferences(() => this.render()));
    this.cleanupFuncs.push(onPanelClaim(owner => { if (owner !== 'agent' && this.mode !== 'idle') this.close(); }));
    this.cleanupFuncs.push(() => this.cleanups.forEach((cleanup) => cleanup()));
    (window as unknown as { __agent: AgentSystem }).__agent = this; // driven by the Playwright tests
  }

  /** What the agent is doing now, read every frame by the companion (no object built, unlike state). */
  get phase(): Mode {
    return this.mode;
  }

  onState(listener: () => void): () => void { this.stateListeners.add(listener); return () => { this.stateListeners.delete(listener); }; }

  /** The same explicit actions as the card, for the semantic view and single-switch interface. */
  accessibleActions(): { key: string; label: string; run: () => void }[] {
    const version = this.requestId;
    const safe = (run: () => void) => () => { if (version === this.requestId) run(); };
    const items: { key: string; label: string; run: () => void }[] = [];
    if (this.mode === 'thinking') return [{ key: 'cancel', label: 'Cancelar petición', run: safe(() => this.close()) }];
    if (this.mode === 'memory') {
      items.push({ key: 'save', label: 'Guardar ajuste actual', run: safe(() => this.saveComfort()) }, { key: 'restore', label: 'Revisar ajuste guardado', run: safe(() => this.restoreComfort()) }, { key: 'forget', label: 'Olvidar ajuste guardado', run: safe(() => this.forgetComfort()) });
    } else if (this.mode === 'session') {
      for (const minutes of [5, 15, 25]) items.push({ key: `minutes-${minutes}`, label: `${minutes} minutos disponibles`, run: safe(() => { this.sessionChoice.minutes = minutes; this.render(); }) });
      for (const energy of ['low', 'steady'] as const) items.push({ key: energy, label: energy === 'low' ? 'Poca energía' : 'Energía normal', run: safe(() => { this.sessionChoice.energy = energy; this.render(); }) });
      items.push({ key: 'prepare', label: 'Preparar propuesta de sesión', run: safe(() => this.planSession()) }, { key: 'checkpoint', label: 'Pausar y volver', run: safe(() => this.openReturn()) });
    } else if (this.mode === 'resume') {
      if (this.returnStage === 'edit') items.push({ key: 'save', label: 'Guardar y pausar', run: safe(() => this.saveReturn()) }, { key: 'task', label: 'Otra tarea', run: safe(() => this.nextReturnTask()) });
      else items.push({ key: 'review', label: 'Revisar retorno', run: safe(() => this.prepareReturn()) }, { key: 'new', label: 'Nuevo punto', run: safe(() => this.editReturn()) });
      items.push({ key: 'forget', label: 'Olvidar punto de retorno', run: safe(() => this.forgetReturn()) });
    } else if (this.mode === 'preview' || this.mode === 'suggestion') {
      if (this.plan?.steps.length) items.push({ key: 'apply', label: 'Aplicar los cambios revisados', run: safe(() => this.apply()) });
      else if (this.sessionComplete) items.push({ key: 'next', label: 'Elegir otra sesión', run: safe(() => this.openSession()) });
      else if (this.dialogueTurn) items.push({ key: 'reply', label: 'Responder por voz', run: safe(() => this.replyHandler?.()) });
    } else if (this.mode === 'log') items.push({ key: 'undo', label: 'Deshacer este plan', run: safe(() => this.undoWhole()) });
    items.push({ key: 'close', label: 'Cerrar o descartar', run: safe(() => this.close()) });
    return items;
  }

  previewLocalPlan(plan: AgentPlan, guard?: () => boolean): void {
    this.close(); this.intent = 'companion'; this.plan = plan; this.localPlanGuard = guard ?? null;
    this.mode = plan.ok ? 'preview' : 'error'; this.show();
  }

  get hasConversation(): boolean {
    return this.conversation.snapshot().length > 0;
  }

  get awaitingReply(): boolean {
    return this.mode === 'preview' && !this.sessionComplete && !this.returnPlan && this.plan?.ok === true && this.plan.steps.length === 0;
  }

  get conversationVersion(): number {
    return this.conversationEpoch;
  }

  get returnVersion(): number { return this.returnEpoch; }
  get awaitingReturnNote(): boolean { return this.returnDictating; }
  get returnState(): { stage: 'edit' | 'saved'; cardId: string; nextStep: string; dictating: boolean } {
    const note = this.returnStage === 'saved' ? readResumeNote() : this.returnDraft;
    return { stage: this.returnStage, cardId: note?.cardId ?? '', nextStep: note?.nextStep ?? '', dictating: this.returnDictating };
  }

  finishReturnDictation(text?: string): void {
    this.returnDictating = false;
    if (text) this.setReturnNote(text);
  }

  onReply(handler: () => void): () => void {
    this.replyHandler = handler;
    return () => { if (this.replyHandler === handler) this.replyHandler = null; };
  }

  forgetConversation(): void {
    ++this.conversationEpoch;
    stopListening();
    this.close();
    this.conversation.clear();
    this.plan = null;
    this.said = '';
    (window as unknown as { __heard: unknown }).__heard = null;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    workspace.notify({ text: 'Conversation forgotten. Your workspace settings are unchanged.', error: false });
  }

  openComfortMemory(): void {
    this.close();
    this.plan = null;
    this.mode = 'memory';
    this.show();
  }

  saveComfort(): void {
    const ok = saveComfortMemory(workspace.state.comfort);
    workspace.notify({ text: this.language().startsWith('es')
      ? ok ? 'Ajuste guardado en este navegador. Solo se guardan cinco ajustes del espacio.' : 'No se pudo guardar el ajuste. El almacenamiento no está disponible.'
      : ok ? 'Setup saved in this browser. Only five workspace settings are stored.' : 'The setup could not be saved. Storage is unavailable.', error: !ok });
    if (ok && this.savedSetupPlan) this.openComfortMemory();
    else if (this.mode === 'memory') this.render();
  }

  forgetComfort(): void {
    const ok = forgetComfortMemory();
    const es = this.language().startsWith('es');
    workspace.notify({ text: es ? ok ? 'Ajuste guardado olvidado. El espacio actual se mantiene.' : 'No se pudo borrar el ajuste guardado.' : ok ? 'Saved setup forgotten. Your current workspace is unchanged.' : 'The saved setup could not be removed.', error: !ok });
    if (ok && this.savedSetupPlan) this.close();
    if (this.mode === 'memory') this.render();
  }

  restoreComfort(): void {
    const saved = readComfortMemory();
    this.close();
    if (!saved) {
      workspace.notify({ text: this.language().startsWith('es') ? 'Todavía no hay un ajuste guardado. Di "recuerda este ajuste" cuando te resulte cómodo.' : 'No setup saved yet. Say "remember this setup" when it feels right.', error: false });
      this.openComfortMemory();
      return;
    }
    const before = workspace.state.comfort;
    const c = saved.comfort;
    const steps: AgentPlan['steps'] = [];
    if (before.reach !== c.reach || before.scale !== c.scale) steps.push({ op: { op: 'set_comfort', reach: c.reach, scale: c.scale }, why: 'Your saved distance and text size' });
    if (before.side !== c.side) steps.push({ op: { op: 'set_comfort', side: c.side }, why: 'Your saved side' });
    if (before.turnDeg !== c.turnDeg) steps.push({ op: { op: 'set_comfort', turnDeg: c.turnDeg }, why: 'Your saved turn range' });
    if (before.tiltDeg !== c.tiltDeg) steps.push({ op: { op: 'set_comfort', tiltDeg: c.tiltDeg }, why: 'Your saved height' });
    this.intent = 'companion';
    this.plan = { ok: true, source: 'saved-setup', steps, summary: this.language().startsWith('es')
      ? steps.length ? 'Puedo recuperar el ajuste que guardaste. Revisa los cambios antes de aplicarlos.' : 'Ya estás usando tu ajuste guardado.'
      : steps.length ? 'I can restore the setup you saved. Review the changes before applying.' : 'You are already using your saved setup.' };
    this.savedSetupPlan = true;
    this.mode = 'preview';
    this.show();
  }

  openSession(): void {
    this.close();
    this.sessionChoice = { ...DEFAULT_SESSION };
    this.mode = 'session';
    this.show();
  }

  planSession(choice: SessionChoice = this.sessionChoice, text = ''): void {
    if (!Number.isInteger(choice.minutes) || choice.minutes < 5 || choice.minutes > 90 || !['low', 'steady'].includes(choice.energy)) {
      workspace.notify({ text: this.language().startsWith('es') ? 'Elige entre 5 y 90 minutos disponibles. No se iniciará nada.' : 'Choose 5 to 90 available minutes. Nothing will start.', error: true });
      return;
    }
    void this.run('session', text, { sessionChoice: { ...choice } });
  }

  openReturn(savedOnly = false): void {
    this.close();
    this.plan = null;
    this.returnStage = readResumeNote() ? 'saved' : 'edit';
    this.returnDraft = { cardId: returnTasks(workspace.state)[0]?.card.id ?? '', nextStep: '' };
    this.mode = 'resume';
    this.show();
    if (savedOnly && this.returnStage === 'edit') workspace.notify({ text: this.language().startsWith('es') ? 'Todavía no hay un punto de retorno guardado.' : 'There is no saved checkpoint yet.', error: false });
  }

  private editReturn(): void {
    this.openReturn();
    this.returnStage = 'edit';
    this.render();
  }

  setReturnNote(text: string): void {
    if (this.mode !== 'resume' || this.returnStage !== 'edit') this.editReturn();
    if (!this.returnDraft?.cardId) return;
    this.returnDraft.nextStep = nextStepText(text);
    this.render();
  }

  private nextReturnTask(): void {
    const tasks = returnTasks(workspace.state);
    const index = tasks.findIndex(t => t.card.id === this.returnDraft?.cardId);
    this.returnDraft = { cardId: tasks[(index + 1) % tasks.length]?.card.id ?? '', nextStep: '' };
    ++this.returnEpoch; // an in-flight dictation must not be attached to a different task
    this.returnDictating = false;
    this.render();
  }

  saveReturn(): void {
    if (this.mode !== 'resume' || this.returnStage !== 'edit') this.editReturn();
    const task = returnTasks(workspace.state).find(t => t.card.id === this.returnDraft?.cardId);
    const es = this.language().startsWith('es');
    const notify = (text: string) => workspace.notify({ text, error: true });
    if (!task) { notify(es ? 'Elige una tarea abierta antes de guardar.' : 'Choose an open task before saving.'); return; }
    const running = workspace.state.timers.filter(t => t.state === 'running');
    if (running.length > 1 || running.some(t => t.cardId && t.cardId !== task.card.id)) {
      notify(es ? 'Hay un bloque activo en otra tarea. Elígela con Otra tarea o pausa ese reloj.' : 'Another task has a running block. Choose it with Other task or pause that timer.');
      return;
    }
    const timer = running[0] ?? workspace.state.timers.find(t => t.state === 'paused' && t.cardId === task.card.id);
    const before = readResumeNote();
    if (!saveResumeNote({ boardId: task.board.id, cardId: task.card.id, nextStep: this.returnDraft?.nextStep ?? '', ...(timer ? { timerId: timer.id } : {}) })) {
      notify(es ? 'No se pudo guardar. El reloj sigue como estaba.' : 'Could not save. The timer is unchanged.');
      return;
    }
    if (timer?.state === 'running') {
      const result = workspace.dispatch({ op: 'pause_timer', timer: timer.id }, { label: es ? 'Pausar trabajo' : 'Pause work' });
      if (!result.ok) {
        if (before) saveResumeNote(before); else forgetResumeNote();
        notify(es ? 'No se pudo pausar el reloj. Revisa el punto guardado antes de salir.' : 'Could not pause the timer. Review the saved checkpoint before leaving.');
        return;
      }
    }
    workspace.flush();
    this.returnStage = 'saved';
    this.render();
    workspace.notify({ text: es ? 'Punto de retorno guardado aquí. Ninguna tarea se ha marcado como terminada.' : 'Checkpoint saved here. No task was marked complete.', error: false });
  }

  forgetReturn(): void {
    this.close();
    const ok = forgetResumeNote();
    workspace.notify({ text: this.language().startsWith('es') ? ok ? 'Punto de retorno borrado. Tus tareas y relojes se mantienen.' : 'No se pudo borrar el punto de retorno.' : ok ? 'Checkpoint forgotten. Your tasks and timers are unchanged.' : 'Could not forget the checkpoint.', error: !ok });
  }

  private prepareReturn(): void {
    const note = readResumeNote();
    const context = note && resumeContext(note, workspace.state);
    const es = this.language().startsWith('es');
    if (!note || context?.status !== 'ready') { this.openReturn(true); return; }
    if (workspace.state.timers.some(t => t.state === 'running' && t.id !== context.timer?.id)) {
      workspace.notify({ text: es ? 'Hay otro bloque en marcha. No lo interrumpo ni inicio otro.' : 'Another block is running. It will not be interrupted or duplicated.', error: true });
      return;
    }
    this.close();
    this.intent = 'companion';
    const steps: AgentPlan['steps'] = [];
    if (!inRoom(this.world)) steps.push({ op: { op: 'focus_board', board: context.task.board.id }, why: es ? 'Volver al tablero de tu tarea' : 'Return to your task board' });
    const timer = context.timer?.state === 'paused' ? context.timer : undefined;
    if (timer) steps.push({ op: { op: 'resume_timer', timer: timer.id }, why: es ? 'Continuar el mismo bloque con el tiempo restante' : 'Continue the same block with its remaining time' });
    this.returnPlan = { note, boardId: context.task.board.id, ...(timer ? { timerId: timer.id } : {}) };
    this.plan = { ok: true, source: 'saved-work', summary: es
      ? `Volver a "${context.task.card.title.slice(0, 45)}".${note.nextStep ? ` Siguiente paso: ${note.nextStep.slice(0, 100)}` : ''} ${timer ? 'El mismo reloj seguirá solo al aplicar.' : 'No se iniciará ningún reloj.'}`
      : `Return to "${context.task.card.title.slice(0, 45)}".${note.nextStep ? ` Next step: ${note.nextStep.slice(0, 100)}` : ''} ${timer ? 'The same timer continues only after Apply.' : 'No timer will start.'}`, steps };
    this.mode = 'preview';
    this.show();
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
  async run(intent: Intent, text: string = dayText(), options: { context?: string; auto?: boolean; sessionChoice?: SessionChoice } = {}): Promise<void> {
    if (this.mode === 'thinking') return;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    if (this.dialogueTurn) this.conversation.resolve('discarded');
    this.dialogueTurn = !options.auto;
    this.savedSetupPlan = false;
    this.returnPlan = null;
    this.localPlanGuard = null;
    this.sessionComplete = false;
    this.sessionTarget = null;
    this.checkingComfort = false;
    this.said = text;
    const requestId = ++this.requestId;
    this.intent = intent;
    this.plan = null;
    this.mode = 'thinking';
    this.quiet = options.auto === true;
    this.startedAt = this.timings.requested = performance.now();
    if (!this.quiet) this.show();
    const requestedWorkspace = workspace.state;
    const plan = await requestPlan(intent, text, requestedWorkspace, deskPose(this.world), options.context, this.quiet ? [] : this.conversation.snapshot(), options.sessionChoice);
    if (requestId !== this.requestId || this.mode !== 'thinking') return; // cancelled or superseded
    if (plan.network) {
      // The network or the AI is out of reach (or slower than AI_PATIENCE_MS): "thinking" ends now, the card goes away
      // and one calm line says so. The boards were never locked; the hands carry on.
      this.close();
      workspace.notify({ text: manualModeNotice(), error: false });
      return;
    }
    this.timings.previewed = performance.now();
    if (this.quiet && (!plan.ok || plan.steps.length === 0)) {
      this.mode = 'idle';
      if (!plan.ok) workspace.notify({ text: 'The AI could not suggest a next step right now.', error: false });
      return;
    }
    this.plan = plan;
    if (intent === 'session' && plan.ok) {
      const timer = plan.steps.find((s) => s.op.op === 'start_timer')?.op;
      const ref = timer?.op === 'start_timer' ? timer.card : undefined;
      for (const board of requestedWorkspace.boards) for (const column of board.columns.slice(0, -1)) for (const card of column.cards) {
        if (card.id === ref || card.title.toLowerCase() === ref?.toLowerCase()) this.sessionTarget = { card: card.id, board: board.id };
      }
    }
    if (plan.ok && this.dialogueTurn) this.conversation.remember({ user: text || TITLES[intent], assistant: plan.summary ?? '', outcome: plan.steps.length ? 'proposed' : 'discussed' });
    this.mode = !plan.ok ? 'error' : this.quiet ? 'suggestion' : 'preview';
    if (this.quiet) this.show();
    this.render();
    this.speak(plan.ok ? plan.summary ?? '' : plan.error ?? '');
  }

  apply(): void {
    const plan = this.plan;
    if (this.mode === 'preview' && plan?.ok && this.localPlanGuard && !this.localPlanGuard()) {
      this.plan = { ok: false, steps: [], error: 'El espacio o el permiso cambiaron. Revisa una propuesta nueva antes de aplicar.' };
      this.mode = 'error'; this.render(); return;
    }
    if (this.mode === 'resume') { this.prepareReturn(); return; }
    if (this.returnPlan && this.mode === 'preview' && plan?.ok) {
      const target = this.returnPlan;
      const context = resumeContext(target.note, workspace.state);
      if (JSON.stringify(readResumeNote()) !== JSON.stringify(target.note) || context.status !== 'ready' || context.task.board.id !== target.boardId ||
        (target.timerId && (context.timer?.id !== target.timerId || context.timer.state !== 'paused')) ||
        workspace.state.timers.some(t => t.state === 'running' && (target.timerId || t.id !== target.note.timerId))) {
        this.plan = { ok: false, steps: [], error: this.language().startsWith('es') ? 'La tarea, el reloj o el punto guardado han cambiado. Vuelve a revisar el retorno.' : 'The task, timer or checkpoint changed. Review the return again.' };
        this.mode = 'error';
        this.render();
        return;
      }
    }
    if (this.intent === 'session' && plan?.ok && plan.steps.length > 0 && (this.mode === 'preview' || this.mode === 'suggestion')) {
      const target = this.sessionTarget;
      const board = workspace.state.boards.find((b) => b.id === target?.board);
      if (!target || workspace.state.timers.some((t) => t.state === 'running') || !board?.columns.slice(0, -1).some((c) => c.cards.some((k) => k.id === target.card))) {
        this.conversation.resolve('discarded');
        this.plan = { ok: false, steps: [], error: this.language().startsWith('es') ? 'La tarea o el temporizador han cambiado. Prepara otra sesión sin interrumpir el bloque actual.' : 'The task or timer changed. Prepare another session without interrupting the current block.' };
        this.mode = 'error';
        this.render();
        return;
      }
    }
    // A wrapped-up day is remembered with the agent's words, even when nothing needed clearing: tomorrow starts there.
    if (this.intent === 'wrap_up' && plan?.ok && (this.mode === 'preview' || this.mode === 'suggestion')) {
      progress.recordWrapUp(plan.summary ?? '');
      if (plan.steps.length === 0) workspace.notify({ text: 'Day wrapped up. See you tomorrow.', error: false });
    }
    // In the room the layout stays where Fit room put it, on the real desk and walls: rearranging steps are left out.
    const steps = plan && inRoom(this.world) ? plan.steps.filter((step) => step.op.op !== 'arrange_space') : plan?.steps ?? [];
    if ((this.mode !== 'preview' && this.mode !== 'suggestion') || !plan || steps.length === 0) {
      this.close();
      return;
    }
    const before = workspace.state;
    const result = workspace.dispatch(
      steps.map((step) => step.op),
      {
        label: this.returnPlan ? 'Return to work' : this.savedSetupPlan ? 'Saved setup' : 'AI plan',
        viewer: deskPose(this.world),
        notice: `${plan.summary ?? 'Plan applied.'} Tap here to see why, or undo a step.`,
        agent: {
          intent: this.intent,
          summary: plan.summary ?? '',
          source: plan.source ?? '',
          steps: steps.map((step) => ({ label: describeStep(step.op, before), why: step.why })),
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
    const checkIn = (this.dialogueTurn || this.savedSetupPlan) && steps.some((step) => step.op.op === 'set_comfort');
    if (this.dialogueTurn) this.conversation.resolve('applied');
    play('apply');
    this.close();
    if (checkIn) {
      this.checkingComfort = true;
      const spanish = this.language().startsWith('es');
      this.intent = 'companion';
      this.said = '';
      this.dialogueTurn = true;
      this.plan = { ok: true, steps: [], summary: spanish
        ? 'El ajuste está aplicado. ¿Cómo te resulta? Puedes pedir otro cambio o deshacer. Si te va bien, di "recuerda este ajuste".'
        : 'The adjustment is applied. How does it feel? Ask for another change or undo. If it feels right, say "remember this setup".' };
      this.mode = 'preview';
      this.show();
      this.speak(this.plan.summary!);
    }
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

  /** "Help me start", from the button or by voice: five minutes on the first bit of [task] (else the task in progress). */
  firstStep(task = ''): void {
    void this.run('first_step', task);
  }

  /** The end of the day, from the button or by voice: the agent names what got done and clears it for tomorrow. */
  wrapUp(): void {
    void this.run('wrap_up', '', { context: wrapUpContext(workspace.state, progress.today()) });
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
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    ++this.requestId;
    if (this.dialogueTurn) this.conversation.resolve('discarded');
    this.dialogueTurn = false;
    this.checkingComfort = false;
    this.savedSetupPlan = false;
    this.sessionComplete = false;
    this.sessionTarget = null;
    this.returnPlan = null;
    ++this.returnEpoch;
    this.returnDictating = false;
    this.localPlanGuard = null;
    this.mode = 'idle';
    this.quiet = false;
    this.setVisible(false);
    for (const listener of this.stateListeners) listener();
  }

  /** "Yes" by voice: applies the plan on the card, or takes the waiting nudge to the agent. False when neither. */
  acceptByVoice(): boolean {
    if (this.mode === 'resume') { this.returnStage === 'edit' ? this.saveReturn() : this.prepareReturn(); return true; }
    if (this.sessionComplete) { this.openSession(); return true; }
    if (this.mode === 'session') { this.planSession(); return true; }
    if ((this.mode === 'preview' || this.mode === 'suggestion') && this.plan) {
      this.apply();
      return true;
    }
    return this.mode === 'idle' && this.acceptNudge();
  }

  /** "No" by voice: closes the card, whatever it shows. False when no card is open. */
  dismiss(): boolean {
    if (this.mode === 'idle') return false;
    this.close();
    return true;
  }

  update(): void {
    if (this.mode === 'thinking' && !this.quiet && this.slots && !accessPreferences.reducedMotion) this.breathe(performance.now() - this.startedAt);
    const now = Date.now();
    if (now < this.nextWatch) return;
    this.nextWatch = now + WATCH_EVERY_MS;
    this.watch(now);
  }

  /**
   * One look at the workspace for something worth a nudge (every 30 s; tests pass a later clock). The first look after
   * the app opens on a new day may offer to plan today from what is still open (src/workspace/progress.ts).
   */
  watch(now: number): Nudge | null {
    if (this.nudge || this.mode !== 'idle') return null;
    const previous = progress.previousVisit;
    const dayStart = this.seen.has('day-start') ? null : dayStartNudge(workspace.state, previous, progress.day(previous ?? ''), now, progress.wrapUpOn(previous));
    const dayEnd = dayEndNudge(workspace.state, progress.today(now), now, progress.wrappedUp(now));
    const nudge = dayStart ?? findNudge(workspace.state, now, this.seen, this.runningSince) ?? (dayEnd && !this.seen.has(dayEnd.key) ? dayEnd : null);
    if (nudge) {
      this.seen.add(nudge.key);
      this.setNudge(nudge);
    }
    return nudge;
  }

  /** A timer rang: after a focus block the agent suggests the next one; after a break, getting back to work. */
  private timerFinished(timer: Timer): void {
    if (/^Session: /.test(timer.label)) {
      const es = this.language().startsWith('es');
      const text = es ? 'Tu bloque ha terminado. Puedes dejarlo aquí o elegir otra sesión. La tarea sigue abierta.' : 'Your block has ended. You can stop here or choose another session. The task stays open.';
      if (this.mode !== 'idle') { workspace.notify({ text, error: false }); return; }
      this.close();
      this.intent = 'session';
      this.sessionComplete = true;
      this.said = '';
      this.plan = { ok: true, steps: [], summary: text, source: 'session-clock' };
      this.mode = 'preview';
      this.show();
      this.speak(text);
      return;
    }
    if (this.mode !== 'idle') return;
    const { intent, context } = timerContext(timer, workspace.state);
    void this.run(intent, '', { context, auto: true });
  }

  /** Reads the agent's words aloud when the user asked for it; the card always shows the same words as text. */
  private speak(text: string): void {
    if (!settings.readAloud || !text || accessPreferences.presentationMode || isListening() || typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.language();
    utterance.volume = accessPreferences.voiceVolume;
    utterance.rate = accessPreferences.speechRate;
    speechSynthesis.speak(utterance);
  }

  /** English unless the link or the person chose another (src/i18n/language.ts). */
  private language(): string {
    return appLanguage();
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
    for (const listener of this.stateListeners) listener();
    const slots = this.slots;
    if (!slots) return;
    slots.title.setProperties({ fontSize: 2.4 });
    const showUndo = this.mode === 'log';
    slots.steps.forEach((row) => row.undo.setProperties({ display: showUndo ? 'flex' : 'none', borderColor: idleBorder(COLOR.base) }));
    slots.discard.setProperties({ borderColor: idleBorder(COLOR.base) });
    slots.reply.setProperties({ display: 'none', borderColor: idleBorder(COLOR.primary) });
    slots.stepList.setProperties({ display: 'flex' });
    slots.thinking.setProperties({ display: 'none' });
    slots.conversation.setProperties({ display: 'none' });
    slots.conversation.setProperties({ height: 18.6 });
    slots.stepList.setProperties({ height: 28.2 });
    slots.summary.setProperties({ height: 6.4 });
    slots.summary.setProperties({ fontSize: 1.7 });
    slots.forget.setProperties({ display: 'flex' });
    slots.profileControls.setProperties({ display: 'none' });
    slots.sessionControls.setProperties({ display: 'none' });
    slots.returnControls.setProperties({ display: 'none' });
    slots.said.setProperties({ display: 'flex' });
    slots.memory.setProperties({ display: 'flex' });

    if (this.mode === 'resume') { this.renderReturn(slots); return; }

    if (this.mode === 'session') {
      const es = this.language().startsWith('es');
      slots.title.setProperties({ text: es ? 'Una sesion a tu ritmo' : 'A session at your pace' });
      slots.source.setProperties({ text: es ? 'Tu eliges' : 'Your choice' });
      slots.summary.setProperties({ height: 9.5, fontSize: 1.9, color: COLOR.text, text: panelText(es
        ? `Elige tiempo y energía. Una sola tarea: con poca energía, 5 minutos; con energía normal, hasta ${Math.min(this.sessionChoice.minutes, 25)}. Nada cambia hasta aplicar.`
        : `Choose time and energy. One task: low energy, five minutes; steady energy, up to ${Math.min(this.sessionChoice.minutes, 25)}. Nothing changes until Apply.`) });
      slots.stepList.setProperties({ display: 'none' });
      slots.conversation.setProperties({ display: 'flex', height: 25.1 });
      slots.sessionReturnLabel.setProperties({ text: es ? 'Pausar / volver' : 'Pause / resume' });
      slots.said.setProperties({ display: 'none' });
      slots.memory.setProperties({ display: 'none' });
      slots.forget.setProperties({ display: 'none' });
      slots.sessionControls.setProperties({ display: 'flex' });
      slots.budgets.forEach((b, i) => b.setProperties({ backgroundColor: this.sessionChoice.minutes === [5, 15, 25][i] ? COLOR.primary : COLOR.base }));
      slots.budgetLabels.forEach((b, i) => { const n = [5, 15, 25][i]; b.setProperties({ text: this.sessionChoice.minutes === n ? `[${n} min]` : `${n} min` }); });
      slots.energies.forEach((b, i) => b.setProperties({ backgroundColor: this.sessionChoice.energy === (i ? 'steady' : 'low') ? COLOR.primary : COLOR.base }));
      const low = es ? 'Poca energia' : 'Low energy';
      const steady = es ? 'Normal' : 'Steady';
      slots.energyLabels[0].setProperties({ text: this.sessionChoice.energy === 'low' ? `[${low}]` : low });
      slots.energyLabels[1].setProperties({ text: this.sessionChoice.energy === 'steady' ? `[${steady}]` : steady });
      slots.apply.setProperties({ display: 'none' });
      slots.reply.setProperties({ display: 'flex' });
      slots.replyLabel.setProperties({ text: es ? 'Preparar' : 'Prepare' });
      slots.discardLabel.setProperties({ text: es ? 'Cerrar' : 'Close' });
      slots.note.setProperties({ text: es ? 'Solo para esta propuesta. No se guarda en tu perfil.' : 'Only for this proposal. Not saved in your profile.' });
      return;
    }

    if (this.mode === 'memory') {
      const saved = readComfortMemory();
      const es = this.language().startsWith('es');
      const c = saved?.comfort;
      const side = c?.side === 'both' ? (es ? 'ambos lados' : 'both sides') : c?.side === 'right' ? (es ? 'derecha' : 'right') : (es ? 'izquierda' : 'left');
      slots.title.setProperties({ text: es ? 'Mi ajuste' : 'My comfortable setup' });
      slots.source.setProperties({ text: es ? 'En este navegador' : 'In this browser' });
      slots.summary.setProperties({ height: 16, fontSize: 1.9, color: COLOR.text, text: panelText(c
        ? es ? `Tu ajuste guardado: paneles a ${Math.round(c.reach * 62)} cm, texto al ${Math.round(c.scale * 100)}%, ${side}. Giro: ${c.turnDeg} grados. Inclinación: ${c.tiltDeg} grados. Puedes recuperarlo o reemplazarlo por la posición actual.`
          : `Your saved setup: panels ${Math.round(c.reach * 62)} cm away, text at ${Math.round(c.scale * 100)}%, ${side}. Turn: ${c.turnDeg} degrees. Tilt: ${c.tiltDeg} degrees. Restore it, or replace it with the current setup.`
        : es ? 'Cuando el espacio te resulte cómodo, guarda el ajuste actual. Podrás recuperarlo en otra visita y revisar los cambios antes de aplicarlos.'
          : 'When the space feels right, save the current setup. You can restore it on another visit and review changes before applying.') });
      slots.stepList.setProperties({ display: 'none' });
      slots.conversation.setProperties({ display: 'flex' });
      slots.said.setProperties({ text: '' });
      slots.memory.setProperties({ text: es ? 'Solo cinco ajustes. No guarda conversaciones ni notas de salud.' : 'Five settings only. No conversations or health notes.' });
      // There is no conversation to forget here: the button runs the guided setup again (src/onboarding/setup.ts).
      slots.forget.setProperties({ display: 'flex' });
      slots.forgetLabel.setProperties({ text: panelText(es ? 'Calibración guiada' : 'Recalibrate') });
      slots.profileControls.setProperties({ display: saved ? 'flex' : 'none' });
      slots.restoreLabel.setProperties({ text: es ? 'Recuperar' : 'Restore' });
      slots.forgetSetupLabel.setProperties({ text: es ? 'Olvidar ajuste' : 'Forget saved' });
      slots.apply.setProperties({ display: 'none' });
      slots.reply.setProperties({ display: 'flex' });
      slots.replyLabel.setProperties({ text: es ? saved ? 'Reemplazar' : 'Guardar actual' : saved ? 'Replace saved' : 'Save current' });
      slots.discardLabel.setProperties({ text: es ? 'Cerrar' : 'Close' });
      slots.note.setProperties({ text: '' });
      return;
    }

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
    const spanish = this.language().startsWith('es');
    const conversation = (this.dialogueTurn || this.sessionComplete) && (!plan || plan.steps.length === 0);
    if (conversation) {
      slots.stepList.setProperties({ display: 'none' });
      slots.conversation.setProperties({ display: 'flex' });
      slots.summary.setProperties({ height: 16 });
      slots.summary.setProperties({ fontSize: (plan?.summary?.length ?? 0) > 220 ? 1.7 : 2.1 });
      const said = this.said.length > 100 ? `${this.said.slice(0, 97)}...` : this.said;
      slots.said.setProperties({ text: panelText(said ? `${spanish ? 'Tú' : 'You'}: ${said}` : '') });
      slots.memory.setProperties({ text: spanish
        ? 'Solo esta visita. Los cambios aplicados quedan en AI log.'
        : 'This visit only. Applied changes stay in AI log.' });
      slots.forgetLabel.setProperties({ text: panelText(spanish ? 'Olvidar conversación' : 'Forget conversation') });
    }
    const suggestion = this.mode === 'suggestion';
    slots.title.setProperties({ text: suggestion ? `Suggestion: ${TITLES[this.intent].toLowerCase()}` : TITLES[this.intent] });
    if (this.intent === 'companion' && spanish) slots.title.setProperties({ text: panelText('Tu acompañante') });
    if (this.sessionComplete) slots.title.setProperties({ text: spanish ? 'Bloque terminado' : 'Block finished' });
    if (this.mode === 'thinking') {
      slots.source.setProperties({ text: 'Asking Amazon Nova' });
      slots.summary.setProperties({ text: 'Thinking...', color: COLOR.text });
      this.rows([]);
      slots.thinking.setProperties({ display: 'flex' });
      this.breathe(performance.now() - this.startedAt); // still, with reduced motion: drawn once, mid-breath
      slots.note.setProperties({ text: '' });
      slots.apply.setProperties({ display: 'none' });
      slots.discardLabel.setProperties({ text: spanish ? 'Cancelar' : 'Cancel' });
      return;
    }
    if (this.mode === 'error' || !plan) {
      slots.source.setProperties({ text: '' });
      slots.summary.setProperties({ text: panelText(plan?.error ?? 'Something went wrong.'), color: COLOR.error });
      this.rows([]);
      slots.note.setProperties({ text: '' });
      slots.apply.setProperties({ display: 'none' });
      slots.reply.setProperties({ display: this.dialogueTurn || this.returnPlan ? 'flex' : 'none' });
      slots.replyLabel.setProperties({ text: spanish ? 'Hablar' : 'Talk' });
      slots.discardLabel.setProperties({ text: spanish ? 'Cerrar' : 'Close' });
      return;
    }
    const seconds = plan.latencyMs != null ? `, ${(plan.latencyMs / 1000).toFixed(1)} s` : '';
    const by = !plan.source ? (spanish ? 'Ajuste aplicado' : 'Adjustment applied') : plan.source === 'built-in' ? 'Built-in planner' : sourceLabel(plan.source);
    slots.source.setProperties({ text: `${by}${seconds}` });
    slots.summary.setProperties({ text: panelText(plan.summary ?? ''), color: COLOR.text });
    if (this.returnPlan) {
      slots.title.setProperties({ text: spanish ? 'Retomar tu tarea' : 'Return to your task' });
      slots.summary.setProperties({ height: 12, fontSize: 1.7 });
      slots.stepList.setProperties({ height: 22.6 });
    }
    this.rows(plan.steps.map((s, i) => ({ title: `${i + 1}. ${describeStep(s.op, workspace.state)}`, why: s.why, undone: false })));
    const more = plan.steps.length > STEP_ROWS ? `+${plan.steps.length - STEP_ROWS} more steps. ` : '';
    const hasSteps = plan.steps.length > 0;
    slots.note.setProperties({ text: panelText(`${more}${plan.note ?? (hasSteps ? (spanish ? 'Revisa los cambios antes de aplicar.' : 'Review changes before applying.') : '')}`) });
    slots.apply.setProperties({ display: hasSteps || (!this.dialogueTurn && !this.sessionComplete) ? 'flex' : 'none' });
    slots.applyLabel.setProperties({ text: hasSteps ? (spanish ? 'Aplicar' : 'Apply') : 'OK' });
    slots.reply.setProperties({ display: this.dialogueTurn || this.savedSetupPlan || this.sessionComplete || this.returnPlan ? 'flex' : 'none' });
    slots.replyLabel.setProperties({ text: this.returnPlan ? spanish ? 'Ver punto' : 'Checkpoint' : this.sessionComplete ? spanish ? 'Otra sesion' : 'Next session' : this.savedSetupPlan ? spanish ? 'Mi ajuste' : 'My setup' : spanish ? 'Responder' : 'Reply' });
    slots.discardLabel.setProperties({ text: !hasSteps ? (spanish ? 'Cerrar' : 'Close') : suggestion ? 'Not now' : spanish ? 'Descartar' : 'Discard' });
  }

  private renderReturn(slots: Slots): void {
    const es = this.language().startsWith('es');
    const note = readResumeNote();
    const saved = this.returnStage === 'saved' && note;
    const context = saved ? resumeContext(saved, workspace.state) : null;
    const tasks = returnTasks(workspace.state);
    const task = saved ? context?.status === 'ready' ? context.task : null : tasks.find(t => t.card.id === this.returnDraft?.cardId);
    const next = saved ? saved.nextStep : this.returnDraft?.nextStep;
    slots.title.setProperties({ text: es ? saved ? 'Tu punto de retorno' : 'Pausar sin perder el hilo' : saved ? 'Your checkpoint' : 'Pause without losing your place', fontSize: 2.2 });
    slots.source.setProperties({ text: es ? 'En este navegador' : 'In this browser' });
    const summary = saved && context?.status !== 'ready'
      ? es ? context?.status === 'done' ? 'Esta tarea ya está terminada. El punto guardado no la volverá a abrir.' : 'La tarea ya no existe. El punto guardado no la recreará.' : context?.status === 'done' ? 'This task is already complete. The checkpoint will not reopen it.' : 'This task no longer exists. The checkpoint will not recreate it.'
      : task ? `${es ? 'Tarea' : 'Task'}: ${task.card.title.slice(0, 65)}. ${next ? `${es ? 'Siguiente paso' : 'Next step'}: ${next}` : es ? 'Puedes dictar una pista para cuando vuelvas. Guardar no termina la tarea.' : 'You can dictate a clue for when you return. Saving does not complete the task.'}`
        : es ? 'No tienes tareas abiertas. Crea tus tareas con Plan my day antes de guardar un punto de retorno.' : 'No open tasks. Add your tasks with Plan my day before saving a checkpoint.';
    slots.summary.setProperties({ height: 16, fontSize: 1.9, color: COLOR.text, text: panelText(summary) });
    slots.stepList.setProperties({ display: 'none' });
    slots.conversation.setProperties({ display: 'flex' });
    slots.forget.setProperties({ display: 'none' });
    slots.said.setProperties({ text: panelText(task ? `${es ? 'Tablero' : 'Board'}: ${task.board.title.slice(0, 55)}${!saved ? ` (${Math.max(0, tasks.findIndex(t => t.card.id === task.card.id)) + 1}/${tasks.length})` : ''}` : '') });
    const timer = saved && context?.status === 'ready' ? context.timer : null;
    const clock = timer ? es ? timer.state === 'paused' ? 'El reloj sigue en pausa. Revisa antes de reanudar.' : timer.state === 'done' ? 'El reloj ya terminó. No se iniciará otro.' : 'Este reloj ya está en marcha.' : timer.state === 'paused' ? 'The timer stays paused. Review before resuming.' : timer.state === 'done' ? 'The timer has ended. No new timer will start.' : 'This timer is already running.'
      : saved ? es ? 'Puedes volver a la tarea. No se iniciará un reloj nuevo.' : 'You can return to the task. No new timer will start.'
        : es ? 'Guardar pausa el reloj activo de esta tarea. Para la nota, di: "cuando vuelva, ...".' : 'Saving pauses this task\'s active timer. For a note, say: "when I return, ...".';
    slots.memory.setProperties({ text: panelText(clock) });
    slots.returnControls.setProperties({ display: 'flex' });
    slots.returnEditControls.setProperties({ display: saved || !task ? 'none' : 'flex' });
    slots.returnForget.setProperties({ display: note ? 'flex' : 'none' });
    slots.returnTaskLabel.setProperties({ text: es ? 'Otra tarea' : 'Other task' });
    slots.returnNoteLabel.setProperties({ text: es ? 'Dictar pista' : 'Dictate next step' });
    slots.returnForgetLabel.setProperties({ text: es ? 'Olvidar punto' : 'Forget checkpoint' });
    slots.note.setProperties({ text: es ? 'Guardado local: tarea, pista y reloj. Puedes borrarlo.' : 'Saved here: task, next step and timer. You can forget it.' });
    slots.apply.setProperties({ display: saved && task ? 'flex' : 'none' });
    slots.applyLabel.setProperties({ text: es ? 'Ver retorno' : 'Review return' });
    slots.reply.setProperties({ display: saved || task ? 'flex' : 'none' });
    slots.replyLabel.setProperties({ text: es ? saved ? 'Nuevo punto' : 'Guardar y pausar' : saved ? 'New checkpoint' : 'Save and pause' });
    slots.discardLabel.setProperties({ text: es ? 'Cerrar' : 'Close' });
  }

  /**
   * The orb that keeps Nova's second or two alive instead of a spinner or a counter, in the violet the companion
   * shimmers in as it thinks (src/studio/companion-system.ts): its core breathes, and a ring of light rises from it and
   * fades. Two restyles a frame while it shows, nothing otherwise. With reduced motion it holds still, mid-breath.
   */
  private breathe(ms: number): void {
    const slots = this.slots;
    if (!slots) return;
    const still = accessPreferences.reducedMotion;
    const breath = still ? 0.5 : 0.5 - 0.5 * Math.cos((2 * Math.PI * ms) / BREATH_MS);
    const ripple = still ? 0.4 : (ms % RIPPLE_MS) / RIPPLE_MS;
    const halo = 0.55 + 0.65 * ripple;
    const core = 0.86 + 0.18 * breath;
    const glow = 0.4 * (1 - ripple) * (1 - ripple);
    // The core sits inside the halo, so it is scaled against the halo's own scale.
    slots.halo.setProperties({ transformScaleX: halo, transformScaleY: halo, opacity: glow });
    slots.core.setProperties({ transformScaleX: core / halo, transformScaleY: core / halo, opacity: 0.7 + 0.3 * breath }); // its own: opacity is inherited otherwise
    this.orb.halo = halo;
    this.orb.core = core;
    this.orb.glow = glow;
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
      thinking: get('plan-thinking'),
      halo: get('plan-thinking-halo'),
      core: get('plan-thinking-core'),
      stepList: get('plan-steps'),
      conversation: get('plan-conversation'),
      said: get('plan-said'),
      memory: get('plan-memory'),
      forgetLabel: get('plan-forget-label'),
      forget: get('plan-forget'),
      profileControls: get('plan-profile-controls'),
      restoreLabel: get('plan-restore-label'),
      forgetSetupLabel: get('plan-forget-setup-label'),
      sessionControls: get('plan-session-controls'),
      budgets: [get('session-5'), get('session-15'), get('session-25')],
      budgetLabels: [get('session-5-label'), get('session-15-label'), get('session-25-label')],
      energies: [get('energy-low'), get('energy-steady')],
      energyLabels: [get('energy-low-label'), get('energy-steady-label')],
      returnControls: get('plan-return-controls'),
      returnEditControls: get('return-edit-controls'),
      returnForget: get('return-forget'),
      returnTaskLabel: get('return-task-label'),
      returnNoteLabel: get('return-note-label'),
      returnForgetLabel: get('return-forget-label'),
      sessionReturnLabel: get('session-return-label'),
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
      reply: get('plan-reply'),
      replyLabel: get('plan-reply-label'),
    };
    const base: Record<Key, string> = { apply: COLOR.primary, discard: COLOR.base, reply: COLOR.primary, forget: COLOR.base, 'restore-setup': COLOR.primary, 'forget-setup': COLOR.base, 'session-return': COLOR.base, 'return-task': COLOR.base, 'return-note': COLOR.base, 'return-forget': COLOR.base, 'session-5': COLOR.base, 'session-15': COLOR.base, 'session-25': COLOR.base, 'energy-low': COLOR.base, 'energy-steady': COLOR.base, 'undo-0': COLOR.base, 'undo-1': COLOR.base, 'undo-2': COLOR.base, 'undo-3': COLOR.base };
    const controls: (readonly [Key, Element])[] = [
      ...slots.steps.map((row, i) => [`undo-${i}` as Key, row.undo] as const),
      ['apply', slots.apply],
      ['discard', slots.discard],
      ['reply', slots.reply],
      ['forget', get('plan-forget')],
      ['restore-setup', get('plan-restore-setup')],
      ['forget-setup', get('plan-forget-setup')],
      ['session-return', get('session-return')],
      ['return-task', get('return-task')],
      ['return-note', get('return-note')],
      ['return-forget', get('return-forget')],
      ...slots.budgets.map((b, i) => [`session-${[5, 15, 25][i]}` as Key, b] as const),
      ...slots.energies.map((b, i) => [i ? 'energy-steady' : 'energy-low', b] as const),
    ];
    new PanelHits(get('plan-root'), controls, {
      click: (key) => {
        if (key === 'discard') this.close();
        else if (key === 'reply') this.mode === 'resume' ? this.returnStage === 'edit' ? this.saveReturn() : this.editReturn() : this.returnPlan ? this.openReturn(true) : this.mode === 'session' ? this.planSession() : this.sessionComplete || (this.intent === 'session' && this.mode === 'error') ? this.openSession() : this.mode === 'memory' ? this.saveComfort() : this.savedSetupPlan ? this.openComfortMemory() : this.replyHandler?.();
        else if (key === 'session-return') this.openReturn();
        else if (key === 'return-task') this.nextReturnTask();
        else if (key === 'return-note') { this.returnDictating = true; this.replyHandler?.(); }
        else if (key === 'return-forget') this.forgetReturn();
        else if (key === 'forget') {
          if (this.mode === 'memory') { this.close(); requestSetup(); } // "Recalibrate" on the My setup card
          else this.forgetConversation();
        }
        else if (key === 'restore-setup') this.restoreComfort();
        else if (key === 'forget-setup') this.forgetComfort();
        else if (key.startsWith('session-')) { this.sessionChoice.minutes = Number(key.slice(8)); this.render(); }
        else if (key.startsWith('energy-')) { this.sessionChoice.energy = key.slice(7) as Energy; this.render(); }
        else if (key === 'apply') this.mode === 'log' ? this.undoWhole() : this.apply();
        else this.undoStep(Number(key.slice(5)));
      },
      hover: (key, hovered) => {
        const control = controls.find(([k]) => k === key)?.[1];
        if (!control) return;
        const selected = key.startsWith('session-') ? Number(key.slice(8)) === this.sessionChoice.minutes : key.startsWith('energy-') ? key.slice(7) === this.sessionChoice.energy : false;
        const colour = selected ? COLOR.primary : base[key];
        control.setProperties({ borderColor: idleBorder(colour) });
        hoverFades.paint(control, colour, hovered); // src/ui/hover.ts
      },
    }, this.cleanups, { name: 'agent', modal: true });
    return slots;
  }

  private undoWhole(): void {
    if (this.action && workspace.undoAction(this.action.id)) play('undo'); // refreshLog closes the card once nothing is left
  }

  private show(): void {
    claimPanel('agent');
    this.place();
    this.setVisible(true);
    this.render();
  }

  /** In front of the focus board, facing the user's anchor, sized to fit the headset's view (Layout.kt). */
  private place(): void {
    const pose = JSON.parse(engine.previewPose(JSON.stringify(workspace.state))) as Pose;
    const object = this.entity.object3D!;
    object.position.set(pose.x, pose.y, pose.z);
    object.rotation.set(pose.pitch, pose.yaw, 0);
    object.scale.setScalar(workspace.panelScale);
  }

  /** Hidden means not drawn and not hit by any pointer. */
  private setVisible(visible: boolean): void {
    const object = this.entity.object3D! as Object3D & { pointerEvents?: string };
    object.visible = visible;
    object.pointerEvents = visible ? undefined : 'none'; // undefined: back to pointer-events' default (only listeners)
  }
}
