/** A user-owned sequence: progress here never completes or edits a workspace card. */
export type WorkflowStepState = 'pending' | 'done' | 'skipped';

export interface WorkflowStep {
  id: string;
  text: string;
  state: WorkflowStepState;
}

export interface WorkflowSnapshot {
  taskId: string;
  steps: WorkflowStep[];
  currentId: string | null;
  complete: boolean;
}

export const WORKFLOW_LIMITS = Object.freeze({ steps: 12, stepLength: 240, taskIdLength: 100 });

function taskId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim() && value.length <= WORKFLOW_LIMITS.taskIdLength && !/[\x00-\x1f\x7f]/.test(value);
}

function stepText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > WORKFLOW_LIMITS.stepLength * 4 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= WORKFLOW_LIMITS.stepLength ? text : null;
}

function validSteps(values: unknown): string[] | null {
  if (!Array.isArray(values) || values.length < 1 || values.length > WORKFLOW_LIMITS.steps) return null;
  const steps: string[] = [];
  for (const value of values) {
    const text = stepText(value);
    if (!text) return null;
    steps.push(text);
  }
  return steps;
}

/** Parses only the steps the user wrote; numbering and list bullets are presentation, not new instructions. */
export function stepsFromUserText(value: string): string[] | null {
  if (typeof value !== 'string' || value.length > WORKFLOW_LIMITS.steps * WORKFLOW_LIMITS.stepLength * 2) return null;
  return validSteps(value.split(/\r?\n/).filter(line => line.trim()).map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')));
}

function copyStep(step: WorkflowStep): WorkflowStep { return { id: step.id, text: step.text, state: step.state }; }

/**
 * One sequence in memory. `complete` means every step was resolved (done or skipped), never that the workspace
 * task was finished. Only the current pending step can be confirmed/skipped, so a stale button cannot advance
 * another step or a replacement sequence. Starting a new sequence clears that sequence's Undo history.
 */
export class WorkflowStore {
  private task = '';
  private steps: WorkflowStep[] = [];
  private run = 0;
  private readonly history: WorkflowStep[][] = [];

  start(id: string, values: string[]): boolean {
    const texts = validSteps(values);
    if (!taskId(id) || !texts || this.run >= 999_999_999) return false;
    const run = ++this.run;
    this.task = id;
    this.steps = texts.map((text, i) => ({ id: `step-${run}-${i + 1}`, text, state: 'pending' }));
    this.history.length = 0;
    return true;
  }

  snapshot(): WorkflowSnapshot {
    return {
      taskId: this.task,
      steps: this.steps.map(copyStep),
      currentId: this.steps.find(step => step.state === 'pending')?.id ?? null,
      complete: this.steps.length > 0 && this.steps.every(step => step.state !== 'pending'),
    };
  }

  confirm(id: string): boolean { return this.resolve(id, 'done'); }
  skip(id: string): boolean { return this.resolve(id, 'skipped'); }

  private resolve(id: string, state: 'done' | 'skipped'): boolean {
    const current = this.steps.find(step => step.state === 'pending');
    if (!current || current.id !== id) return false;
    this.history.push(this.steps.map(copyStep));
    current.state = state;
    return true;
  }

  undo(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.steps = previous;
    return true;
  }

  reset(): void {
    this.task = '';
    this.steps = [];
    this.history.length = 0;
  }

  /** A caller may explicitly restore a previously saved snapshot; this module does not persist it. */
  restore(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as WorkflowSnapshot;
    if (!taskId(candidate.taskId) || !Array.isArray(candidate.steps)) return false;
    const texts = validSteps(candidate.steps.map(step => step?.text));
    if (!texts) return false;
    const ids = new Set<string>();
    let maximumRun = this.run;
    const steps: WorkflowStep[] = [];
    for (let i = 0; i < candidate.steps.length; i++) {
      const step = candidate.steps[i];
      if (!step || typeof step.id !== 'string') return false;
      const match = /^step-([1-9]\d{0,8})-([1-9]\d?)$/.exec(step.id);
      if (!match || ids.has(step.id) || !['pending', 'done', 'skipped'].includes(step.state)) return false;
      ids.add(step.id);
      maximumRun = Math.max(maximumRun, Number(match[1]));
      steps.push({ id: step.id, text: texts[i], state: step.state });
    }
    const currentId = steps.find(step => step.state === 'pending')?.id ?? null;
    const complete = steps.every(step => step.state !== 'pending');
    if (candidate.currentId !== currentId || candidate.complete !== complete) return false;
    this.task = candidate.taskId;
    this.steps = steps;
    this.run = maximumRun;
    this.history.length = 0;
    return true;
  }
}

export interface RoutineTemplate {
  readonly id: 'errands' | 'work' | 'study';
  readonly title: string;
  readonly steps: readonly string[];
}

/** Optional, general-purpose prompts. The caller must show them for review before starting a chosen task. */
export const routineTemplates: readonly RoutineTemplate[] = Object.freeze([
  Object.freeze({ id: 'errands' as const, title: 'Una gestión', steps: Object.freeze(['Reunir la información que necesito', 'Hacer un paso de la gestión elegida', 'Revisar qué queda pendiente']) }),
  Object.freeze({ id: 'work' as const, title: 'Una tarea de trabajo', steps: Object.freeze(['Abrir el material de esta tarea', 'Hacer el primer cambio que he elegido', 'Revisar el cambio y anotar dónde continuar']) }),
  Object.freeze({ id: 'study' as const, title: 'Una sesión de estudio', steps: Object.freeze(['Elegir el material que quiero estudiar', 'Revisar una parte pequeña', 'Anotar lo que entendí y la siguiente duda']) }),
]);

export function routineFromUserSteps(id: string, values: string[]): WorkflowSnapshot | null {
  const store = new WorkflowStore();
  return store.start(id, values) ? store.snapshot() : null;
}
