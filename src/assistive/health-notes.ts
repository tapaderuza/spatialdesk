/**
 * User-authored consultation preparation, held only by the caller. No DOM, storage, network, diagnosis,
 * scheduling or medical inference. A caller that persists this data must use its explicit secure-vault flow.
 */
export const CONSULTATION_LIMITS = Object.freeze({
  topic: 120, question: 400, observation: 1000, summary: 3000, label: 160, location: 240,
  instructions: 2000, reference: 300, questions: 20, observations: 30, appointments: 12, professionalPlan: 20,
});

export interface ConsultationQuestion { id: string; text: string }
export interface PersonalObservation { id: string; on: string; text: string }
export interface AppointmentNote { id: string; when: string; provider: string; location: string; preparation: string }
export interface PlanProvenance { label: string; reference: string; providedOn: string; verification: 'not-verified' }
export interface ProfessionalPlanReminder { id: string; title: string; instructions: string; remindAt: string; provenance: PlanProvenance }
export interface ConsultationNotes {
  version: 1;
  topic: string;
  questions: ConsultationQuestion[];
  observations: PersonalObservation[];
  appointments: AppointmentNote[];
  professionalPlan: ProfessionalPlanReminder[];
  summary: string;
}

export type AppointmentInput = Omit<AppointmentNote, 'id'>;
export interface ProfessionalPlanInput {
  title: string;
  instructions: string;
  remindAt: string;
  provenance: Omit<PlanProvenance, 'verification'>;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max: number, required = true, verbatim = false): string | null {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return null;
  if (required && !value.trim()) return null;
  return verbatim ? value : value.trim();
}

/** A calendar date is validated without converting the user's day to another timezone. */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Accepts a date or a local/offset ISO date-time; it records the supplied value, never infers a timezone. */
export function isValidDateTime(value: unknown): value is string {
  if (isValidDate(value)) return true;
  if (typeof value !== 'string') return false;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!m || !isValidDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] ?? 0) > 59) return false;
  if (m[5] && m[5] !== 'Z') {
    const hours = Number(m[5].slice(1, 3)), minutes = Number(m[5].slice(4));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return false;
  }
  return true;
}

function validId(value: unknown, prefix: string): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}[1-9]\\d{0,8}$`).test(value);
}

function appointment(input: unknown, id: string): AppointmentNote | null {
  const data = object(input);
  if (!data || !isValidDateTime(data.when)) return null;
  const provider = text(data.provider, CONSULTATION_LIMITS.label);
  const location = text(data.location, CONSULTATION_LIMITS.location, false);
  const preparation = text(data.preparation, CONSULTATION_LIMITS.instructions, false, true);
  return provider !== null && location !== null && preparation !== null ? { id, when: data.when, provider, location, preparation } : null;
}

function provenance(input: unknown): PlanProvenance | null {
  const data = object(input);
  if (!data || !isValidDate(data.providedOn)) return null;
  const label = text(data.label, CONSULTATION_LIMITS.label);
  const reference = text(data.reference, CONSULTATION_LIMITS.reference, false);
  // A source label is a user's statement, never proof of clinical approval or professional identity.
  return label !== null && reference !== null ? { label, reference, providedOn: data.providedOn, verification: 'not-verified' } : null;
}

function planReminder(input: unknown, id: string): ProfessionalPlanReminder | null {
  const data = object(input);
  if (!data || !isValidDateTime(data.remindAt)) return null;
  const title = text(data.title, CONSULTATION_LIMITS.label);
  const instructions = text(data.instructions, CONSULTATION_LIMITS.instructions, true, true);
  const source = provenance(data.provenance);
  return title !== null && instructions !== null && source ? { id, title, instructions, remindAt: data.remindAt, provenance: source } : null;
}

export function emptyConsultationNotes(): ConsultationNotes {
  return { version: 1, topic: '', questions: [], observations: [], appointments: [], professionalPlan: [], summary: '' };
}

/** Unknown properties, including alleged diagnoses or validation flags, are never copied into the result. */
export function readConsultationNotes(value: unknown): ConsultationNotes | null {
  const data = object(value);
  if (!data || data.version !== 1) return null;
  const topic = text(data.topic, CONSULTATION_LIMITS.topic, false);
  const summary = text(data.summary, CONSULTATION_LIMITS.summary, false, true);
  if (topic === null || summary === null) return null;
  const result = emptyConsultationNotes();
  result.topic = topic; result.summary = summary;
  const ids = new Set<string>();
  const lists = ['questions', 'observations', 'appointments', 'professionalPlan'] as const;
  for (const key of lists) {
    const items = data[key];
    if (!Array.isArray(items) || items.length > CONSULTATION_LIMITS[key]) return null;
    for (const item of items) {
      const entry = object(item);
      const prefix = { questions: 'q', observations: 'o', appointments: 'a', professionalPlan: 'p' }[key];
      if (!entry || !validId(entry.id, prefix) || ids.has(entry.id)) return null;
      ids.add(entry.id);
      if (key === 'questions') {
        const question = text(entry.text, CONSULTATION_LIMITS.question);
        if (question === null) return null;
        result.questions.push({ id: entry.id, text: question });
      } else if (key === 'observations') {
        const observation = text(entry.text, CONSULTATION_LIMITS.observation, true, true);
        if (!isValidDate(entry.on) || observation === null) return null;
        result.observations.push({ id: entry.id, on: entry.on, text: observation });
      } else if (key === 'appointments') {
        const parsed = appointment(entry, entry.id);
        if (!parsed) return null;
        result.appointments.push(parsed);
      } else {
        const parsed = planReminder(entry, entry.id);
        if (!parsed) return null;
        result.professionalPlan.push(parsed);
      }
    }
  }
  return result;
}

function copyNotes(notes: ConsultationNotes): ConsultationNotes {
  return {
    version: 1, topic: notes.topic, summary: notes.summary,
    questions: notes.questions.map(q => ({ ...q })), observations: notes.observations.map(o => ({ ...o })),
    appointments: notes.appointments.map(a => ({ ...a })), professionalPlan: notes.professionalPlan.map(p => ({ ...p, provenance: { ...p.provenance } })),
  };
}

/** Keeps potentially health-related information in this instance only; persistence is an explicit caller concern. */
export class ConsultationStore {
  private notes = emptyConsultationNotes();
  private serial = 0;

  snapshot(): ConsultationNotes { return copyNotes(this.notes); }

  load(value: unknown): boolean {
    const parsed = readConsultationNotes(value);
    if (!parsed) return false;
    this.notes = parsed;
    for (const entry of [...parsed.questions, ...parsed.observations, ...parsed.appointments, ...parsed.professionalPlan]) this.serial = Math.max(this.serial, Number(entry.id.slice(1)));
    return true;
  }

  setTopic(value: string): boolean {
    const clean = text(value, CONSULTATION_LIMITS.topic, false);
    if (clean === null) return false;
    this.notes.topic = clean; return true;
  }

  setSummary(value: string): boolean {
    const clean = text(value, CONSULTATION_LIMITS.summary, false, true);
    if (clean === null) return false;
    this.notes.summary = clean; return true;
  }

  addQuestion(value: string): string | null {
    const clean = text(value, CONSULTATION_LIMITS.question);
    if (clean === null || this.notes.questions.length >= CONSULTATION_LIMITS.questions || this.serial >= 999_999_999) return null;
    const id = `q${++this.serial}`; this.notes.questions.push({ id, text: clean }); return id;
  }

  updateQuestion(id: string, value: string): boolean {
    const item = this.notes.questions.find(q => q.id === id), clean = text(value, CONSULTATION_LIMITS.question);
    if (!item || clean === null) return false;
    item.text = clean; return true;
  }

  addObservation(on: string, value: string): string | null {
    const clean = text(value, CONSULTATION_LIMITS.observation, true, true);
    if (!isValidDate(on) || clean === null || this.notes.observations.length >= CONSULTATION_LIMITS.observations || this.serial >= 999_999_999) return null;
    const id = `o${++this.serial}`; this.notes.observations.push({ id, on, text: clean }); return id;
  }

  updateObservation(id: string, on: string, value: string): boolean {
    const item = this.notes.observations.find(o => o.id === id), clean = text(value, CONSULTATION_LIMITS.observation, true, true);
    if (!item || !isValidDate(on) || clean === null) return false;
    item.on = on; item.text = clean; return true;
  }

  addAppointment(input: AppointmentInput): string | null {
    const id = `a${this.serial + 1}`, clean = appointment(input, id);
    if (!clean || this.notes.appointments.length >= CONSULTATION_LIMITS.appointments || this.serial >= 999_999_999) return null;
    this.serial++; this.notes.appointments.push(clean); return id;
  }

  updateAppointment(id: string, input: AppointmentInput): boolean {
    const index = this.notes.appointments.findIndex(a => a.id === id), clean = appointment(input, id);
    if (index < 0 || !clean) return false;
    this.notes.appointments[index] = clean; return true;
  }

  addProfessionalPlan(input: ProfessionalPlanInput): string | null {
    const id = `p${this.serial + 1}`, clean = planReminder(input, id);
    if (!clean || this.notes.professionalPlan.length >= CONSULTATION_LIMITS.professionalPlan || this.serial >= 999_999_999) return null;
    this.serial++; this.notes.professionalPlan.push(clean); return id;
  }

  updateProfessionalPlan(id: string, input: ProfessionalPlanInput): boolean {
    const index = this.notes.professionalPlan.findIndex(p => p.id === id), clean = planReminder(input, id);
    if (index < 0 || !clean) return false;
    this.notes.professionalPlan[index] = clean; return true;
  }

  remove(kind: 'questions' | 'observations' | 'appointments' | 'professionalPlan', id: string): boolean {
    const list = this.notes[kind];
    if (!Array.isArray(list)) return false;
    const index = list.findIndex(item => item.id === id);
    if (index < 0) return false;
    list.splice(index, 1); return true;
  }

  clear(): void { this.notes = emptyConsultationNotes(); }
  exportMarkdown(): string { return exportConsultationMarkdown(this.notes); }
}

function markdown(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&').replace(/\r?\n/g, ' ');
}

/** Fenced text preserves the user's wording and cannot break out through supplied Markdown or HTML. */
function verbatim(value: string): string {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map(run => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${value}\n${fence}`;
}

/** A structured export of the supplied notes, not an AI or clinical summary. No dates or facts are inferred. */
export function exportConsultationMarkdown(value: ConsultationNotes): string {
  const notes = readConsultationNotes(value);
  if (!notes) throw new Error('Invalid consultation notes.');
  const lines = ['# Preparación de consulta', '', 'Contenido introducido y revisado por la persona usuaria. SpatialDesk no ha realizado un diagnóstico ni ha validado pautas clínicas.', ''];
  if (notes.topic) lines.push(`Tema: ${markdown(notes.topic)}`, '');
  if (notes.summary) lines.push('## Mi resumen editable', '', verbatim(notes.summary), '');
  lines.push('## Preguntas que quiero hacer', '');
  if (!notes.questions.length) lines.push('Sin preguntas anotadas.');
  else for (const question of notes.questions) lines.push(`- ${markdown(question.text)}`);
  lines.push('', '## Observaciones que he anotado', '');
  if (!notes.observations.length) lines.push('Sin observaciones anotadas.');
  else for (const observation of [...notes.observations].sort((a, b) => a.on.localeCompare(b.on))) lines.push(`### ${observation.on}`, '', verbatim(observation.text), '');
  lines.push('', '## Citas y preparación', '');
  if (!notes.appointments.length) lines.push('Sin citas anotadas.');
  else for (const item of notes.appointments) {
    lines.push(`- ${item.when} — ${markdown(item.provider)}${item.location ? ` — ${markdown(item.location)}` : ''}`);
    if (item.preparation) lines.push('', verbatim(item.preparation), '');
  }
  lines.push('', '## Planes copiados por mí', '', 'Procedencia indicada por la persona usuaria y no verificada por SpatialDesk. El texto se conserva; no se propone ni modifica una pauta.', '');
  if (!notes.professionalPlan.length) lines.push('Sin planes copiados.');
  else for (const item of notes.professionalPlan) {
    lines.push(`### ${markdown(item.title)}`, '', `Recordatorio anotado: ${item.remindAt}`, `Fuente indicada: ${markdown(item.provenance.label)} (${item.provenance.providedOn})`);
    if (item.provenance.reference) lines.push(`Referencia indicada: ${markdown(item.provenance.reference)}`);
    lines.push('', verbatim(item.instructions), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export type ProfessionalPracticeKind = 'physical-practice' | 'professional-session' | 'cognitive-practice' | 'communication-practice' | 'supervised-scenario' | 'sensor-review';
export interface ProfessionalPracticeTemplate {
  version: 1;
  id: string;
  title: string;
  kind: ProfessionalPracticeKind;
  provenance: PlanProvenance;
  instructions: string[];
  status: 'draft-unvalidated';
}

/** Data-import schema only. No therapy programs are shipped, scheduled, recommended or activated here. */
export function importProfessionalTemplate(value: unknown): ProfessionalPracticeTemplate | null {
  const data = object(value);
  if (!data || data.version !== 1) return null;
  const id = text(data.id, 100), title = text(data.title, CONSULTATION_LIMITS.label), source = provenance(data.provenance);
  const kinds: readonly unknown[] = ['physical-practice', 'professional-session', 'cognitive-practice', 'communication-practice', 'supervised-scenario', 'sensor-review'];
  if (!id || !title || !source || !kinds.includes(data.kind) || !Array.isArray(data.instructions) || data.instructions.length < 1 || data.instructions.length > 12) return null;
  const instructions: string[] = [];
  for (const item of data.instructions) {
    const clean = text(item, CONSULTATION_LIMITS.instructions, true, true);
    if (clean === null) return null;
    instructions.push(clean);
  }
  return { version: 1, id, title, kind: data.kind as ProfessionalPracticeKind, provenance: source, instructions, status: 'draft-unvalidated' };
}
