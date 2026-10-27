import { expect, test } from '@playwright/test';
import { WorkflowStore, routineFromUserSteps, routineTemplates, stepsFromUserText, WORKFLOW_LIMITS } from '../src/assistive/workflows.js';
import {
  ConsultationStore, CONSULTATION_LIMITS, emptyConsultationNotes, exportConsultationMarkdown,
  importProfessionalTemplate, isValidDate, isValidDateTime, readConsultationNotes,
} from '../src/assistive/health-notes.js';

test('workflow: a deliberate current-step confirmation, skip and Undo preserve stable IDs', () => {
  const store = new WorkflowStore();
  expect(store.snapshot()).toEqual({ taskId: '', steps: [], currentId: null, complete: false });
  expect(store.start('existing-task', ['Abrir el documento', 'Revisar el primer detalle', 'Anotar dónde continuar'])).toBe(true);
  const initial = store.snapshot(), [first, second, third] = initial.steps;
  expect(store.confirm(second.id)).toBe(false); // a stale or out-of-order control cannot skip ahead
  expect(store.snapshot()).toEqual(initial);
  expect(store.confirm(first.id)).toBe(true);
  expect(store.confirm(first.id)).toBe(false); // double input does not confirm the following step
  expect(store.skip(second.id)).toBe(true);
  expect(store.snapshot()).toMatchObject({ taskId: 'existing-task', currentId: third.id, complete: false });
  expect(store.undo()).toBe(true);
  expect(store.snapshot().steps[1]).toEqual({ ...second, state: 'pending' });
  expect(store.confirm(second.id)).toBe(true);
  expect(store.confirm(third.id)).toBe(true);
  expect(store.snapshot()).toMatchObject({ taskId: 'existing-task', currentId: null, complete: true });
  expect(store.snapshot().steps.map(step => step.id)).toEqual(initial.steps.map(step => step.id));
  expect(store.undo()).toBe(true);
  expect(store.snapshot()).toMatchObject({ currentId: third.id, complete: false });
});

test('workflow: invalid replacement leaves progress intact, and a new run rejects an old control', () => {
  const store = new WorkflowStore();
  expect(store.start('k1', ['Un paso', 'Otro paso'])).toBe(true);
  const first = store.snapshot().currentId!;
  store.confirm(first);
  const before = store.snapshot();
  for (const input of [[], [''], ['x'.repeat(WORKFLOW_LIMITS.stepLength + 1)], Array(13).fill('Un paso'), ['Con\u0000control']]) {
    expect(store.start('k2', input)).toBe(false);
    expect(store.snapshot()).toEqual(before);
  }
  expect(store.start('  ', ['Válido'])).toBe(false);
  expect(store.start('k2', ['Revisar un detalle'])).toBe(true);
  expect(store.confirm(first)).toBe(false);
  expect(store.undo()).toBe(false);
  const copy = store.snapshot(); copy.steps[0].text = 'Mutación externa'; copy.steps.length = 0;
  expect(store.snapshot().steps[0].text).toBe('Revisar un detalle');
  store.reset();
  expect(store.snapshot().complete).toBe(false);
});

test('workflow: user-authored lists keep their wording and repeated instructions remain distinct', () => {
  expect(stepsFromUserText('1. Abrir el texto\n\n2) Revisar el texto\n- Anotar una duda')).toEqual(['Abrir el texto', 'Revisar el texto', 'Anotar una duda']);
  expect(stepsFromUserText('')).toBeNull();
  expect(stepsFromUserText('x'.repeat(241))).toBeNull();
  const routine = routineFromUserSteps('k1', ['Revisar', 'Revisar']);
  expect(routine?.steps.map(step => step.text)).toEqual(['Revisar', 'Revisar']);
  expect(new Set(routine?.steps.map(step => step.id)).size).toBe(2);
  expect(routineTemplates.map(template => template.id)).toEqual(['errands', 'work', 'study']);
  expect(Object.isFrozen(routineTemplates[0].steps)).toBe(true);
});

test('workflow: explicit restore validates state and keeps later IDs distinct', () => {
  const original = new WorkflowStore(); original.start('k1', ['Abrir', 'Revisar']); original.confirm(original.snapshot().currentId!);
  const data = original.snapshot(), restored = new WorkflowStore();
  expect(restored.restore(data)).toBe(true);
  expect(restored.snapshot()).toEqual(data);
  const wrong = { ...data, complete: true };
  expect(restored.restore(wrong)).toBe(false);
  expect(restored.snapshot()).toEqual(data);
  expect(restored.restore({ ...data, steps: [{ ...data.steps[0], id: 'duplicate' }, { ...data.steps[1], id: 'duplicate' }] })).toBe(false);
  restored.start('k1', ['Nuevo paso']);
  expect(data.steps.map(step => step.id)).not.toContain(restored.snapshot().currentId);
});

test('consultation: real calendar validation records supplied dates without timezone guesses', () => {
  expect(isValidDate('2024-02-29')).toBe(true);
  expect(isValidDate('2000-02-29')).toBe(true);
  for (const value of ['2025-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-01-00', '0000-01-01', '27/10/2026']) expect(isValidDate(value)).toBe(false);
  expect(isValidDateTime('2026-11-01T10:30')).toBe(true);
  expect(isValidDateTime('2026-11-01T10:30:00+01:00')).toBe(true);
  expect(isValidDateTime('2026-11-01T09:30Z')).toBe(true);
  for (const value of ['2026-11-01T24:00', '2026-11-01T10:60', '2026-11-01T10:30+14:01', '2026-11-01T10:30+15:00', '2026-02-29T10:30']) expect(isValidDateTime(value)).toBe(false);
});

test('consultation: questions, observations, appointments and an editable summary stay user-authored', () => {
  const store = new ConsultationStore();
  expect(store.setTopic('Preparar mi consulta')).toBe(true);
  const question = store.addQuestion('¿Qué documentos debo llevar?')!;
  const observation = store.addObservation('2026-10-27', 'Quiero comentar esta observación propia.\nSin interpretación añadida.')!;
  const appointment = store.addAppointment({ when: '2026-11-18T10:30+01:00', provider: 'Consulta de seguimiento', location: 'Lugar elegido', preparation: 'Llevar el documento anotado por mí.' })!;
  expect(store.setSummary('Este es el resumen que he escrito y revisado.')).toBe(true);
  expect(store.updateQuestion(question, '¿Qué información me falta?')).toBe(true);
  expect(store.updateObservation(observation, '2026-02-30', 'Inválido')).toBe(false);
  expect(store.updateAppointment(appointment, { when: '2026-11-18T11:00+01:00', provider: 'Consulta de seguimiento', location: '', preparation: '' })).toBe(true);
  const copy = store.snapshot(); copy.questions[0].text = 'Cambiado desde fuera';
  expect(store.snapshot().questions[0].text).toBe('¿Qué información me falta?');
  expect(store.exportMarkdown()).toContain('Este es el resumen que he escrito y revisado.');
  expect(store.exportMarkdown()).toContain('2026-11-18T11:00+01:00');
  expect(store.exportMarkdown()).toContain('no ha realizado un diagnóstico');
  expect(store.remove('appointments', appointment)).toBe(true);
  expect(store.remove('appointments', appointment)).toBe(false);
});

test('consultation: copied instructions are exact and cannot claim verified provenance', () => {
  const store = new ConsultationStore();
  const instructions = 'Texto copiado por la persona.\n\nMantener exactamente estas palabras.  ';
  const id = store.addProfessionalPlan({
    title: 'Mi recordatorio', instructions, remindAt: '2026-11-18T10:00',
    provenance: { label: 'Documento indicado por mí', reference: 'Referencia que he escrito', providedOn: '2026-10-27', verification: 'verified' } as any,
  })!;
  expect(id).toBeTruthy();
  expect(store.snapshot().professionalPlan[0].instructions).toBe(instructions);
  expect(store.snapshot().professionalPlan[0].provenance.verification).toBe('not-verified');
  const exported = store.exportMarkdown();
  expect(exported).toContain(instructions);
  expect(exported).toContain('no se propone ni modifica una pauta');
  const loaded = new ConsultationStore();
  expect(loaded.load(store.snapshot())).toBe(true);
  expect(loaded.snapshot()).toEqual(store.snapshot());
  expect(loaded.addQuestion('Otra pregunta')).not.toBe(id);
});

test('consultation: malformed imports, oversized entries and quota limits do not replace good notes', () => {
  const store = new ConsultationStore();
  store.addQuestion('Una pregunta válida');
  const before = store.snapshot();
  expect(store.load({ ...before, observations: [{ id: 'o2', on: '2026-02-30', text: 'No válido' }] })).toBe(false);
  expect(store.load({ ...before, questions: [before.questions[0], before.questions[0]] })).toBe(false);
  expect(store.load({ ...before, summary: 'x'.repeat(CONSULTATION_LIMITS.summary + 1) })).toBe(false);
  expect(store.snapshot()).toEqual(before);
  for (let i = 1; i < CONSULTATION_LIMITS.questions; i++) expect(store.addQuestion(`Pregunta ${i}`)).toBeTruthy();
  expect(store.addQuestion('Fuera de límite')).toBeNull();
  expect(store.addObservation('2026-10-27', 'Con\u0000control')).toBeNull();
  expect(store.remove('not-a-list' as any, 'q1')).toBe(false);
  const sanitised = readConsultationNotes({ ...before, diagnosis: 'No copiar este campo', automatedRecommendation: 'No copiar' });
  expect(Object.keys(sanitised!)).toEqual(Object.keys(emptyConsultationNotes()));
  expect(JSON.stringify(sanitised)).not.toContain('No copiar');
});

test('consultation export: supplied Markdown and HTML remain inert text', () => {
  const store = new ConsultationStore();
  store.addQuestion('<img src="remote" onerror="example"> [enlace](https://example.invalid)');
  const raw = 'Mi texto\n```\n# No es una sección nueva\n<script>ejemplo</script>';
  store.setSummary(raw);
  const output = store.exportMarkdown();
  expect(output).toContain('&lt;img');
  expect(output).toContain('\\[enlace\\]\\(https://example\\.invalid\\)');
  expect(output).toContain(`\n\`\`\`\`text\n${raw}\n\`\`\`\``);
  expect(() => exportConsultationMarkdown({ ...emptyConsultationNotes(), version: 2 } as any)).toThrow('Invalid consultation notes.');
});

test('professional templates: import is always an unvalidated draft, with no built-in therapy content', () => {
  const input = {
    version: 1, id: 'provided-template', title: 'Material aportado por el profesional', kind: 'communication-practice',
    provenance: { label: 'Procedencia introducida por mí', reference: '', providedOn: '2026-10-27', verification: 'verified' },
    instructions: ['Contenido aportado externamente para revisión.'], status: 'clinically-approved', diagnosis: 'No incorporar',
  };
  const template = importProfessionalTemplate(input)!;
  expect(template.status).toBe('draft-unvalidated');
  expect(template.provenance.verification).toBe('not-verified');
  expect(template.instructions).toEqual(input.instructions);
  expect(template).not.toHaveProperty('diagnosis');
  input.instructions[0] = 'Mutación posterior';
  expect(template.instructions[0]).toBe('Contenido aportado externamente para revisión.');
  expect(importProfessionalTemplate({ ...input, instructions: [] })).toBeNull();
  expect(importProfessionalTemplate({ ...input, kind: 'autonomous-diagnosis' })).toBeNull();
  expect(importProfessionalTemplate({ ...input, provenance: { ...input.provenance, providedOn: '2026-13-01' } })).toBeNull();
});
