import type { World } from '@iwsdk/core';
import { AgentSystem } from '../agent/agent-system.js';
import { readComfortMemory, forgetComfortMemory } from '../agent/comfort-memory.js';
import { forgetResumeNote, readResumeNote, returnTasks } from '../agent/resume-note.js';
import { ConsultationStore, importProfessionalTemplate } from '../assistive/health-notes.js';
import { WorkflowStore, routineTemplates, stepsFromUserText } from '../assistive/workflows.js';
import { CommunicationBoard } from '../assistive/communication.js';
import { PrivateVault } from '../assistive/vault.js';
import { inRoom } from '../room/room-system.js';
import { settings, toggleSetting } from '../ui/settings.js';
import { workspace } from '../workspace/store.js';
import type { Op } from '../workspace/model.js';
import { accessPreferences, onAccessPreferences, setAccessPreference, type AccessPreferences } from './preferences.js';
import { beginCalibration, calibrationField, calibrationOps, nextCalibration, previousCalibration, restoreCalibration, setCalibrationValue, type Calibration } from './calibration.js';
import { capabilities } from './capabilities.js';
import type { HubAction, HubField, HubForm, HubPage, HubPresenter, HubView } from './hub-view.js';

const PAGE_LABELS: Record<HubPage, string> = {
  home: 'Tu centro de accesibilidad', fit: 'Ajustar mi espacio', input: 'Elegir cómo controlar', sound: 'Sonido y subtítulos',
  vision: 'Lectura y visión', communication: 'Comunicarme', steps: 'Paso a paso', tasks: 'Mis tareas', consultation: 'Preparar mi consulta',
  memory: 'Mi memoria y caja privada', help: 'Me he perdido', clinical: 'Material profesional', privacy: 'Mis datos y permisos',
  library: 'Funciones y sus límites', share: 'Ayuda elegida por ti', energy: 'Pausar y volver',
};
const FIELD_LABELS = { reach: 'Distancia', scale: 'Tamaño', side: 'Lado', turnDeg: 'Giro', tiltDeg: 'Altura', review: 'Revisar' };
const DEFAULT_STEPS = ['Abrir lo que necesito para esta tarea', 'Revisar un primer detalle', 'Decidir el siguiente paso'];
const field = (id: string, label: string, type: HubField['type'] = 'text', maxLength = 240, value = '', required = true): HubField => ({ id, label, type, maxLength, value, required });
const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export class AssistiveHub implements HubPresenter {
  readonly workflows = new WorkflowStore();
  readonly consultation = new ConsultationStore();
  readonly communication = new CommunicationBoard();
  readonly vault = new PrivateVault();
  private readonly listeners = new Set<() => void>();
  private opened = false;
  private optedIn = false;
  private page: HubPage = 'home';
  private offset = 0;
  private notice = '';
  private caption = '';
  private selectedTask = '';
  private taskFilter = '';
  private calibration: Calibration | null = null;
  private professional: ReturnType<typeof importProfessionalTemplate> = null;
  private quietBefore: { sound: boolean; nudges: boolean; readAloud: boolean } | null = null;
  private lastStepAt = -Infinity;
  private readonly cleanups: (() => void)[] = [];
  private remindersAllowed = false;
  private readonly reminded = new Set<string>();
  private reminderTimer: ReturnType<typeof setInterval>;

  constructor(private readonly world: World) {
    this.cleanups.push(workspace.subscribe(() => this.changed()), onAccessPreferences(() => this.changed()));
    const lock = () => { if (document.visibilityState === 'hidden') this.lockPrivate(); };
    document.addEventListener('visibilitychange', lock);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', lock));
    this.reminderTimer = setInterval(() => this.checkReminders(), 30_000);
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  changed(): void { for (const listener of this.listeners) listener(); }
  open(page: HubPage = 'home'): void {
    this.optedIn = true; this.opened = true; this.page = page; this.offset = 0; this.notice = '';
    if (page === 'fit') this.calibration = beginCalibration(workspace.state.comfort);
    this.changed();
  }
  close(): void { this.opened = false; if (this.optedIn) this.agent()?.close(); this.changed(); }
  yieldPanel(): void { this.opened = false; this.changed(); }
  back(): void { if (this.offset > 0) { this.offset -= 4; this.changed(); } else this.open('home'); }
  nextPage(): void { this.offset = (this.offset + 4) % Math.max(4, Math.ceil(this.actions().length / 4) * 4); this.changed(); }
  getView(): HubView {
    const agent = this.agent();
    if (!this.opened && this.optedIn && agent && agent.phase !== 'idle') {
      const plan = agent.state.plan; const masked = accessPreferences.presentationMode;
      const actions = agent.accessibleActions().map(action => ({ ...action, disabled: masked && action.key === 'apply' }));
      return { owner: 'agent', isOpen: true, page: 'help', title: agent.phase === 'thinking' ? 'Preparando una propuesta' : 'Revisar antes de aplicar',
        summary: masked ? 'Datos ocultos para presentar.' : [plan?.summary, ...(plan?.steps ?? []).map(s => s.why), plan?.error].filter(Boolean).join(' '),
        notice: 'Nada cambia hasta que aceptas. Una respuesta a una pregunta no aplica un plan.', items: actions, forms: [], pageIndex: 0, pageCount: 1,
        caption: masked ? '' : plan?.summary ?? '' };
    }
    const items = this.actions();
    if (this.offset >= items.length) this.offset = 0;
    const workflow = this.workflows.snapshot();
    const masked = accessPreferences.presentationMode && ['consultation', 'steps', 'tasks', 'communication', 'memory', 'clinical'].includes(this.page);
    return { owner: 'hub', isOpen: this.opened, page: this.page, title: PAGE_LABELS[this.page], summary: this.summary(), notice: masked ? '' : this.notice,
      items: items.slice(this.offset, this.offset + 4).map(item => masked ? { ...item, label: 'Dato oculto', detail: '', disabled: true } : item), forms: masked ? [] : this.forms(), pageIndex: Math.floor(this.offset / 4), pageCount: Math.max(1, Math.ceil(items.length / 4)), caption: accessPreferences.presentationMode ? '' : this.caption,
      ...(this.page === 'steps' && workflow.steps.length ? { progress: { completed: workflow.steps.filter(s => s.state === 'done').length, skipped: workflow.steps.filter(s => s.state === 'skipped').length, total: workflow.steps.length } } : {}) };
  }
  private say(text: string): void {
    if (accessPreferences.presentationMode) { this.tell('Desactiva la ocultación para reproducir contenido personal.'); return; }
    this.caption = text;
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text);
      u.lang = new URLSearchParams(location.search).get('lang') || navigator.language;
      u.volume = accessPreferences.voiceVolume; u.rate = accessPreferences.speechRate; speechSynthesis.speak(u);
    }
    this.changed();
  }
  private tell(text: string): void { this.notice = text; this.changed(); }
  private action(key: string, label: string, run: HubAction['run'], detail = '', disabled = false): HubAction { return { key, label, run, detail, disabled }; }
  private preference<K extends keyof AccessPreferences>(key: K, label: string, values: readonly AccessPreferences[K][]): HubAction {
    const v = accessPreferences[key]; const index = values.indexOf(v);
    return this.action(`pref-${key}`, `${label}: ${typeof v === 'boolean' ? v ? 'Sí' : 'No' : v}`, () => {
      if (!setAccessPreference(key, values[(index + 1) % values.length])) this.tell('Ese valor no está disponible.');
    }, 'Pulsa para elegir el siguiente valor.');
  }
  private task() { return returnTasks(workspace.state).find(t => t.card.id === this.selectedTask) ?? returnTasks(workspace.state)[0]; }
  private agent() { return this.world.getSystem(AgentSystem); }
  private preview(ops: Op[], summary: string, guard?: () => boolean): void {
    this.close();
    this.agent()?.previewLocalPlan({ ok: true, source: 'local-accessibility', summary, steps: ops.map(op => ({ op, why: 'Tu elección, revisable y reversible' })) }, guard);
  }
  private calibrate(direction: number): void {
    const c = this.calibration; if (!c) return;
    const f = calibrationField(c); if (f === 'review') return;
    const changes = { reach: 0.1, scale: 0.1, turnDeg: 10, tiltDeg: 5 };
    const value = f === 'side' ? (['both', 'left', 'right'] as const)[(['both', 'left', 'right'].indexOf(c.draft.side) + (direction > 0 ? 1 : 2)) % 3] : Math.round((c.draft[f] + direction * changes[f]) * 100) / 100;
    const updated = setCalibrationValue(c, f, value as never);
    if (updated) { this.calibration = updated; this.changed(); } else this.tell('Has llegado al límite de este ajuste.');
  }
  private reviewCalibration(): void {
    if (!this.calibration) return;
    const c = this.calibration; const before = JSON.stringify(c.original);
    const ops = calibrationOps(c);
    if (!ops.length) { this.tell('El espacio ya tiene estos valores.'); return; }
    this.preview(ops, 'Estos son los ajustes que has elegido. Revisa antes de aplicar; después puedes deshacer.', () => JSON.stringify(workspace.state.comfort) === before);
  }
  private advanceStep(skip = false): void {
    const w = this.workflows.snapshot(); const task = returnTasks(workspace.state).find(t => t.card.id === w.taskId);
    if (!task) { this.tell('La tarea cambió o ya terminó. Elige una tarea abierta.'); return; }
    if (!w.currentId || performance.now() - this.lastStepAt < 700) return;
    const ok = skip ? this.workflows.skip(w.currentId) : this.workflows.confirm(w.currentId);
    if (ok) { this.lastStepAt = performance.now(); this.changed(); }
  }
  private quietPause(): void {
    const ops: Op[] = workspace.state.timers.filter(t => t.state === 'running').map(t => ({ op: 'pause_timer', timer: t.id }));
    if (ops.length && !workspace.dispatch(ops, { label: 'Pausa tranquila' }).ok) return;
    if (!this.quietBefore) this.quietBefore = { sound: settings.sound, nudges: settings.nudges, readAloud: settings.readAloud };
    toggleSetting('sound', false); toggleSetting('nudges', false); toggleSetting('readAloud', false);
    this.tell('Relojes pausados y avisos reducidos. Tus tareas siguen como estaban. No se reanudará ningún bloque por sí solo.');
  }
  private restoreQuiet(): void {
    if (this.quietBefore) { for (const key of ['sound', 'nudges', 'readAloud'] as const) toggleSetting(key, this.quietBefore[key]); this.quietBefore = null; }
    this.tell('Preferencias de avisos recuperadas. Los relojes se mantienen en pausa.');
  }
  private actions(): HubAction[] {
    const a = this.action.bind(this);
    switch (this.page) {
      case 'home': return (['fit', 'communication', 'steps', 'energy', 'input', 'vision', 'sound', 'tasks', 'consultation', 'memory', 'help', 'share', 'privacy', 'library', 'clinical'] as HubPage[]).map(p => a(`page-${p}`, PAGE_LABELS[p], () => this.open(p)));
      case 'fit': return [a('fit-less', 'Un poco menos', () => this.calibrate(-1)), a('fit-more', 'Un poco más', () => this.calibrate(1)),
        a('fit-next', 'Siguiente ajuste', () => { if (this.calibration) this.calibration = nextCalibration(this.calibration); this.changed(); }),
        a('fit-review', 'Revisar los cambios', () => this.reviewCalibration()),
        a('fit-previous', 'Ajuste anterior', () => { if (this.calibration) this.calibration = previousCalibration(this.calibration); this.changed(); }),
        a('fit-reset', 'Reiniciar la propuesta', () => { if (this.calibration) this.calibration = restoreCalibration(this.calibration); this.changed(); }),
        a('fit-save', 'Mi ajuste guardado', () => { this.close(); this.agent()?.openComfortMemory(); })];
      case 'input': return [this.preference('tremorTolerance', 'Tolerancia a inestabilidad', [false, true]), this.preference('dwellMs', 'Mirada: milisegundos', [700, 1000, 1600, 2400, 3200]),
        this.preference('switchEnabled', 'Pulsador con Espacio o Intro', [false, true]), this.preference('scanIntervalMs', 'Barrido: milisegundos', [1000, 1500, 2500, 4000]),
        this.preference('targetGraceMs', 'Margen temporal', [0, 150, 250, 400]), this.preference('clickCooldownMs', 'Separación de pulsaciones', [0, 350, 700, 1000]),
        this.preference('listenPauseMs', 'Pausa al dictar', [1600, 2400, 4000, 6000]), this.preference('listenMaxMs', 'Escucha máxima', [20000, 30000, 45000, 60000]),
        a('handsfree', `Selección sin manos: ${settings.handsFree ? 'Sí' : 'No'}`, () => toggleSetting('handsFree'))];
      case 'sound': return [this.preference('cuesVolume', 'Volumen de avisos', [0, 0.25, 0.5, 0.75, 1]), this.preference('ambienceVolume', 'Volumen de ambiente', [0, 0.25, 0.5, 0.75, 1]),
        this.preference('voiceVolume', 'Volumen de voz', [0, 0.25, 0.5, 0.75, 1]), this.preference('monoAudio', 'Audio mono', [false, true]),
        this.preference('speechRate', 'Velocidad de lectura', [0.7, 0.85, 1, 1.2, 1.5]), this.preference('captionSize', 'Tamaño de subtítulos 2D', [1, 1.2, 1.5, 1.8]),
        a('read-aloud', `Leer los planes: ${settings.readAloud ? 'Sí' : 'No'}`, () => toggleSetting('readAloud')), a('repeat-caption', 'Repetir el último mensaje', () => this.say(this.caption || this.summary()))];
      case 'vision': return [a('contrast', `Contraste alto: ${settings.highContrast ? 'Sí' : 'No'}`, () => { toggleSetting('highContrast'); this.changed(); }),
        this.preference('readingScale', 'Tamaño de lectura 2D', [0.9, 1, 1.2, 1.4, 1.6]), this.preference('reducedMotion', 'Menos movimiento', [false, true]),
        a('read-view', 'Leer esta explicación', () => this.say(this.summary())), a('fit-vision', 'Ajustar lectura en el visor', () => this.open('fit'))];
      case 'communication': return [a('speak-draft', 'Decir el mensaje elegido', () => { if (this.communication.draft) this.say(this.communication.draft); else this.tell('Primero elige o escribe un mensaje.'); }, this.communication.draft || 'Todavía no hay un mensaje elegido.'),
        a('clear-draft', 'Vaciar el mensaje', () => { this.communication.clear(); this.changed(); }),
        ...this.communication.list().map(p => a(`phrase-${p.id}`, p.text, () => { this.communication.select(p.id); this.changed(); }, 'Seleccionar no lo reproduce ni aplica cambios.'))];
      case 'tasks': return returnTasks(workspace.state).filter(t => !this.taskFilter || normal(t.card.title).includes(normal(this.taskFilter))).map(t => a(`task-${t.card.id}`, t.card.title, () => { this.selectedTask = t.card.id; this.open('steps'); }, t.board.title));
      case 'steps': {
        const w = this.workflows.snapshot(); const task = this.task();
        return [a('step-confirm', 'He completado este paso', () => this.advanceStep(), 'Solo confirma el paso actual; la tarea queda abierta.', !w.currentId),
          a('step-skip', 'Saltar este paso', () => this.advanceStep(true), 'Quedará señalado como saltado.', !w.currentId),
          a('step-undo', 'Deshacer el último paso', () => { this.workflows.undo(); this.changed(); }), a('step-read', 'Leer el paso actual', () => this.say(w.steps.find(s => s.id === w.currentId)?.text || 'No hay un paso pendiente.')),
          ...routineTemplates.map(t => a(`routine-${t.id}`, t.title, () => { if (!task) this.tell('Primero elige una tarea abierta.'); else { this.workflows.start(task.card.id, [...t.steps]); this.changed(); } }, 'Usar esta lista propuesta sin completar tu tarjeta.')),
          a('choose-task', 'Elegir otra tarea', () => this.open('tasks'))];
      }
      case 'energy': return [a('quiet-pause', 'Pausar relojes y reducir avisos', () => this.quietPause()), a('quiet-restore', 'Recuperar mis avisos', () => this.restoreQuiet()),
        a('save-place', 'Guardar mi siguiente paso', () => { this.close(); this.agent()?.openReturn(); }), a('return-place', 'Volver a mi punto guardado', () => { this.close(); this.agent()?.openReturn(true); }),
        a('session', 'Elegir una sesión a mi ritmo', () => { this.close(); this.agent()?.openSession(); })];
      case 'consultation': return [a('consult-read', 'Leer mi resumen', () => this.say(this.consultation.snapshot().summary || 'Tu borrador aún no tiene resumen.')),
        a('consult-export', 'Exportar mi resumen revisado', () => this.download('mi-consulta.md', this.consultation.exportMarkdown(), 'text/markdown'), 'Descarga legible con los datos que has escrito.'),
        a('consult-vault', 'Guardar o recuperar en caja privada', () => this.open('memory')), a('consult-reminders', 'Activar avisos en esta visita', () => { this.remindersAllowed = true; this.checkReminders(); this.tell('Avisos activos mientras esta aplicación esté abierta. No modifican tu plan.'); }),
        ...this.consultation.snapshot().questions.map(q => a(`question-${q.id}`, q.text, () => { this.consultation.remove('questions', q.id); this.changed(); }, 'Pulsa para eliminar esta pregunta.'))];
      case 'memory': return [a('vault-save-notes', 'Guardar borrador en caja privada', async () => { const ok = await this.vault.put('consultation', this.consultation.snapshot()); this.tell(ok ? 'Borrador cifrado guardado.' : this.vault.lastError?.message || 'Desbloquea primero la caja privada.'); }),
        a('vault-load-notes', 'Recuperar borrador privado', async () => { const saved = await this.vault.read<unknown>('consultation'); this.tell(saved && this.consultation.load(saved) ? 'Borrador recuperado en esta visita.' : this.vault.lastError?.message || 'No hay un borrador válido guardado.'); }),
        a('vault-lock', 'Bloquear y vaciar borrador abierto', () => this.lockPrivate()), a('vault-export', 'Exportar copia cifrada', () => { const copy = this.vault.exportEncrypted(); if (copy) this.download('spatialdesk-privado.json', copy, 'application/json'); else this.tell('No hay una copia cifrada disponible.'); }),
        a('memory-setup', 'Mi ajuste del espacio', () => { this.close(); this.agent()?.openComfortMemory(); }), a('memory-return', 'Mi punto de retorno', () => { this.close(); this.agent()?.openReturn(true); }),
        a('vault-save-steps', 'Guardar mis pasos en caja privada', async () => { this.tell(await this.vault.put('workflow', this.workflows.snapshot()) ? 'Pasos cifrados guardados.' : this.vault.lastError?.message || 'Desbloquea primero la caja privada.'); }),
        a('vault-load-steps', 'Recuperar mis pasos privados', async () => { const saved = await this.vault.read('workflow'); this.tell(saved && this.workflows.restore(saved) ? 'Pasos recuperados.' : 'No hay pasos válidos guardados.'); })];
      case 'help': return [a('help-task', 'Recordar mi tarea actual', () => this.say(this.task()?.card.title || 'Todavía no hay una tarea abierta.')),
        a('help-repeat', 'Repetir el siguiente paso', () => { const w = this.workflows.snapshot(); this.say(w.steps.find(s => s.id === w.currentId)?.text || 'Puedes elegir una tarea y escribir sus pasos.'); }),
        a('help-home', 'Volver al centro', () => this.open('home')), a('help-return', 'Recuperar mi punto guardado', () => { this.close(); this.agent()?.openReturn(true); }),
        a('help-choices', 'Cómo funcionan las propuestas', () => this.say('Una propuesta no cambia el espacio. Revisa su contenido y pulsa Aplicar. Puedes descartarla o deshacer un cambio aplicado.')),
        a('help-health', 'Qué apoyo de salud ofrece', () => this.say('Puedes preparar preguntas, observaciones y citas con tus propias palabras. No se añaden diagnósticos, tratamientos ni pautas. El material profesional importado no está validado por esta aplicación.'))];
      case 'clinical': return [a('clinical-status', 'Ver procedencia y límites', () => this.tell(this.professional ? JSON.stringify(this.professional).slice(0, 450) : 'Importa una plantilla redactada por un profesional para revisar sus datos. No hay ejercicios terapéuticos predeterminados.')),
        a('clinical-export', 'Exportar plantilla sin validar', () => { if (this.professional) this.download('plantilla-profesional-borrador.json', JSON.stringify(this.professional, null, 2), 'application/json'); else this.tell('No hay una plantilla importada.'); }),
        a('clinical-clear', 'Borrar plantilla de esta visita', () => { this.professional = null; this.changed(); })];
      case 'privacy': return [this.preference('presentationMode', 'Ocultar datos en vista 2D', [false, true]), a('privacy-explain', 'Dónde van mis datos', () => this.say('Los ajustes se guardan en este navegador. El dictado usa Amazon Transcribe; las peticiones al agente usan Amazon Nova. Los borradores de consulta permanecen en memoria salvo que los guardes expresamente en la caja cifrada. No se comparten con un ayudante por defecto.')),
        a('privacy-dialogue', 'Olvidar la conversación con el agente', () => { this.agent()?.forgetConversation(); this.tell('Conversación de esta visita olvidada.'); }),
        a('privacy-return', 'Olvidar el punto de retorno', () => { forgetResumeNote(); this.tell('Punto de retorno borrado. Las tareas y relojes se mantienen.'); }),
        a('privacy-setup', 'Olvidar mi ajuste guardado', () => { forgetComfortMemory(); this.tell('Ajuste guardado borrado; el espacio actual se mantiene.'); }),
        a('privacy-health', 'Vaciar el borrador de esta visita', () => { this.consultation.clear(); this.professional = null; this.caption = ''; this.tell('Borradores de esta visita vaciados. La copia cifrada se mantiene.'); })];
      case 'library': return capabilities.map(c => a(`cap-${c.id}`, `${c.id}. ${c.name}`, () => this.tell(c.detail), `${c.state}: ${c.detail}`));
      case 'share': return [a('share-explain', 'Elegir qué verá un ayudante', () => this.tell('Solo se compartirán los títulos de tareas que autorices. Una sugerencia de configuración esperará tu revisión local. No se comparten notas, consultas ni audio.'))];
    }
  }
  private summary(): string {
    if (accessPreferences.presentationMode && ['consultation', 'steps', 'tasks', 'communication', 'memory', 'clinical'].includes(this.page)) return 'Datos ocultos para presentar esta vista. Desactiva el modo en Mis datos y permisos para volver a verlos.';
    if (this.page === 'fit' && this.calibration) { const f = calibrationField(this.calibration); return f === 'review' ? 'Comprueba lo que has elegido. Nada se aplica hasta revisar la propuesta.' : `${FIELD_LABELS[f]}: ${this.calibration.draft[f]}. Elige lo que te resulte cómodo. No hace falta forzar ningún movimiento.`; }
    if (this.page === 'communication') return this.communication.draft ? `Mensaje elegido: ${this.communication.draft}` : 'Elige o escribe un mensaje. Solo se reproducirá cuando pulses Decir el mensaje elegido.';
    if (this.page === 'steps') { const w = this.workflows.snapshot(); return w.steps.length ? w.currentId ? w.steps.find(s => s.id === w.currentId)!.text : `Recorrido resuelto: ${w.steps.filter(s => s.state === 'done').length} confirmados y ${w.steps.filter(s => s.state === 'skipped').length} saltados. Tu tarjeta sigue abierta hasta que tú la termines.` : `Tarea: ${this.task()?.card.title || 'elige una tarea abierta'}. Puedes escribir pasos o elegir una lista y editarla.`; }
    if (this.page === 'consultation') { const n = this.consultation.snapshot(); return `${n.topic || 'Tu borrador de consulta'}. ${n.questions.length} preguntas, ${n.observations.length} observaciones y ${n.appointments.length} citas. Solo contiene lo que tú escribes. En memoria hasta que elijas guardar cifrado.`; }
    if (this.page === 'memory') return `Caja privada ${this.vault.isUnlocked ? 'desbloqueada' : 'bloqueada'}. Ajuste del espacio: ${readComfortMemory() ? 'guardado' : 'sin guardar'}. Punto de retorno: ${readResumeNote() ? 'guardado' : 'sin guardar'}. Perder la frase impide recuperar la copia cifrada.`;
    if (this.page === 'clinical') return 'Editor de material aportado por profesionales. Las plantillas quedan como borradores no validados; esta aplicación no verifica credenciales ni ejecuta tratamientos.';
    if (this.page === 'input') return 'Elige tu ritmo. El pulsador usa Espacio o Intro: primero arma el barrido y otra pulsación selecciona. La estabilidad es una ayuda de interfaz, no una valoración médica.';
    if (this.page === 'vision') return 'La lectura y las fuentes completas de esta vista 2D no equivalen a una validación con lectores de pantalla en el visor. Puedes ajustar el espacio y el contraste.';
    if (this.page === 'energy') return 'Puedes parar aquí. La pausa no termina tareas ni obliga a continuar. Los avisos de nuevos relojes siguen teniendo su propio comportamiento.';
    if (this.page === 'share') return 'La ayuda es temporal y voluntaria. Un ayudante nunca aplica cambios directamente ni recibe tu borrador privado.';
    return 'Elige qué necesitas ahora. Tus tareas y el espacio actual se conservan; los cambios al espacio se revisan antes de aplicar.';
  }
  private forms(): HubForm[] {
    const task = this.task(); const n = this.consultation.snapshot();
    switch (this.page) {
      case 'tasks': return [{ id: 'task-filter', title: 'Buscar una tarea', fields: [field('filter', 'Palabras del título', 'text', 120, this.taskFilter, false)], submitLabel: 'Buscar', submit: v => { this.taskFilter = v.filter; this.offset = 0; this.changed(); } }];
      case 'communication': return [{ id: 'communication-message', title: 'Escribir un mensaje', fields: [field('message', 'Tu mensaje', 'textarea', 240, this.communication.draft)], submitLabel: 'Elegir este mensaje', submit: v => { if (this.communication.compose(v.message)) this.changed(); else this.tell('Escribe un mensaje de hasta 240 caracteres.'); } },
        { id: 'communication-phrase', title: 'Añadir una frase para esta visita', fields: [field('phrase', 'Frase propia')], submitLabel: 'Añadir frase', submit: v => { this.tell(this.communication.add(v.phrase) ? 'Frase añadida solo para esta visita.' : 'No se pudo añadir la frase. Máximo 24 frases.'); } }];
      case 'steps': return [{ id: 'workflow', title: 'Tus propios pasos', fields: [{ id: 'task', label: 'Tarea abierta', type: 'select', value: task?.card.id, required: true, options: returnTasks(workspace.state).map(t => ({ value: t.card.id, label: t.card.title })) },
        field('steps', 'Un paso por línea (máximo 12)', 'textarea', 2880, this.workflows.snapshot().steps.map(s => s.text).join('\n') || DEFAULT_STEPS.join('\n'))], submitLabel: 'Preparar estos pasos', submit: v => {
          const steps = stepsFromUserText(v.steps); if (!steps || !returnTasks(workspace.state).some(t => t.card.id === v.task) || !this.workflows.start(v.task, steps)) this.tell('Elige una tarea abierta y entre 1 y 12 pasos breves.');
          else { this.selectedTask = v.task; this.lastStepAt = -Infinity; this.tell('Pasos preparados. Confirmarlos no completará tu tarjeta.'); }
        } }];
      case 'consultation': return [
        { id: 'consult-topic', title: 'Tema y resumen que tú redactas', fields: [field('topic', 'Tema', 'text', 120, n.topic, false), field('summary', 'Tu resumen revisable', 'textarea', 3000, n.summary, false)], submitLabel: 'Actualizar borrador', submit: v => { if (this.consultation.setTopic(v.topic) && this.consultation.setSummary(v.summary)) this.changed(); else this.tell('Revisa la longitud del tema o el resumen.'); } },
        { id: 'consult-question', title: 'Añadir una pregunta', fields: [field('question', 'Qué quieres preguntar', 'textarea', 400)], submitLabel: 'Añadir pregunta', submit: v => { if (this.consultation.addQuestion(v.question)) this.changed(); else this.tell('La pregunta no es válida o ya hay 20.'); } },
        { id: 'consult-observation', title: 'Añadir una observación propia', fields: [field('date', 'Fecha', 'date', 10, new Date().toLocaleDateString('en-CA')), field('observation', 'Lo que tú has observado', 'textarea', 1000)], submitLabel: 'Añadir observación', submit: v => { if (this.consultation.addObservation(v.date, v.observation)) this.changed(); else this.tell('Revisa la fecha y el texto.'); } },
        { id: 'consult-appointment', title: 'Añadir una cita', fields: [field('when', 'Fecha y hora local', 'datetime-local', 30), field('provider', 'Profesional o centro', 'text', 160), field('location', 'Lugar', 'text', 240, '', false), field('preparation', 'Lo que quieres llevar o preguntar', 'textarea', 2000, '', false)], submitLabel: 'Añadir cita', submit: v => { if (this.consultation.addAppointment({ when: v.when, provider: v.provider, location: v.location, preparation: v.preparation })) this.changed(); else this.tell('Revisa los datos de la cita.'); } },
        { id: 'consult-plan', title: 'Copiar una indicación recibida', description: 'Se conserva literalmente y como procedencia no verificada. No se genera ni modifica una pauta.', fields: [field('title', 'Nombre', 'text', 160), field('instructions', 'Texto exacto que has recibido', 'textarea', 2000), field('when', 'Fecha y hora del recordatorio', 'datetime-local', 30), field('source', 'Quién aportó el texto', 'text', 160), field('reference', 'Referencia opcional', 'text', 300, '', false), field('on', 'Fecha del documento', 'date', 10)], submitLabel: 'Guardar en el borrador', submit: v => { if (this.consultation.addProfessionalPlan({ title: v.title, instructions: v.instructions, remindAt: v.when, provenance: { label: v.source, reference: v.reference, providedOn: v.on } })) this.changed(); else this.tell('Revisa texto, procedencia y fechas.'); } },
      ];
      case 'memory': return [
        { id: 'vault-unlock', title: this.vault.isUnlocked ? 'Caja privada abierta' : 'Crear o desbloquear caja privada', description: 'Frase de 12 a 256 caracteres. No se guarda y no se puede recuperar si la pierdes.', fields: [field('phrase', 'Frase privada', 'password', 256)], submitLabel: 'Desbloquear', submit: async v => { const ok = await this.vault.unlock(v.phrase); this.tell(ok ? 'Caja privada desbloqueada en esta visita.' : this.vault.lastError?.message || 'No se pudo desbloquear.'); } },
        { id: 'vault-import', title: 'Importar una copia cifrada a una caja vacía', fields: [field('encrypted', 'Contenido de la copia cifrada', 'textarea', 150000)], submitLabel: 'Importar copia cifrada', submit: v => { this.tell(this.vault.importEncrypted(v.encrypted) ? 'Copia importada. Desbloquéala con su frase.' : this.vault.lastError?.message || 'Bloquea y vacía la caja antes de importar una copia.'); } },
        { id: 'vault-clear', title: 'Borrar la copia cifrada de este navegador', description: 'Esta acción elimina la copia privada. No modifica tus tableros.', fields: [field('confirm', 'Escribe BORRAR para confirmar', 'text', 12)], submitLabel: 'Borrar copia privada', submit: async v => { if (v.confirm !== 'BORRAR') this.tell('No se ha borrado nada.'); else { await this.vault.clear(); this.lockPrivate(); this.tell('Copia privada borrada de este navegador.'); } } },
      ];
      case 'clinical': return [{ id: 'clinical-import', title: 'Importar una plantilla para revisar', description: 'Formato JSON con título, procedencia y pasos. Nunca se convierte en contenido clínicamente aprobado.', fields: [field('template', 'Plantilla JSON', 'textarea', 16000)], submitLabel: 'Revisar plantilla', submit: v => { try { const parsed = importProfessionalTemplate(JSON.parse(v.template)); if (!parsed) this.tell('La plantilla no tiene el formato o los límites esperados.'); else { this.professional = parsed; this.tell('Plantilla importada como borrador no validado. No se ejecutará un tratamiento.'); } } catch { this.tell('El JSON no es válido.'); } } }];
      default: return [];
    }
  }
  lockPrivate(): void { this.vault.lock(); this.consultation.clear(); this.professional = null; this.caption = ''; this.changed(); }
  private checkReminders(): void {
    if (!this.remindersAllowed) return;
    const due = this.consultation.snapshot().professionalPlan.filter(p => !this.reminded.has(p.id) && Date.parse(p.remindAt) <= Date.now());
    if (!due.length) return;
    for (const p of due) this.reminded.add(p.id);
    this.notice = 'Tienes un recordatorio de tu plan copiado. Abre tu borrador para revisar el texto exacto; no se ha cambiado ninguna pauta.';
    this.changed();
  }
  private download(name: string, data: string, type: string): void {
    const url = URL.createObjectURL(new Blob([data], { type })); const link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  handleVoice(text: string): boolean {
    const n = normal(text); const routes: Record<string, HubPage> = { 'accesibilidad': 'home', 'centro de accesibilidad': 'home', 'ajustar mi espacio': 'fit', 'calibrar mi espacio': 'fit', 'modo comunicacion': 'communication', 'paso a paso': 'steps', 'preparar mi consulta': 'consultation', 'me he perdido': 'help', 'mi memoria': 'memory', 'mis datos': 'privacy', 'necesito una pausa tranquila': 'energy' };
    if (routes[n]) { this.open(routes[n]); return true; }
    if (!this.opened) return false;
    if (n === 'volver al centro') { this.open('home'); return true; }
    if (this.page === 'fit' && /^(si|vale|siguiente)$/.test(n)) { if (this.calibration) this.calibration = nextCalibration(this.calibration); this.changed(); return true; }
    if (this.page === 'steps' && /^(hecho|paso terminado|confirmar paso)$/.test(n)) { this.advanceStep(); return true; }
    if (this.page === 'steps' && n === 'saltar paso') { this.advanceStep(true); return true; }
    if (this.page === 'communication' && n === 'decir mensaje') { if (this.communication.draft) this.say(this.communication.draft); return true; }
    if (this.page === 'consultation') { this.tell('Este borrador se escribe en la vista 2D y no se envía al agente. Puedes añadir preguntas, observaciones y citas.'); return true; }
    return false;
  }
  dispose(): void { clearInterval(this.reminderTimer); this.lockPrivate(); this.cleanups.forEach(f => f()); this.listeners.clear(); }
}
