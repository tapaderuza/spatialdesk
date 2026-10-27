import type { HubAction, HubField, HubForm, HubPage, HubPresenter, HubView } from './hub-view.js';
import { accessPreferences, onAccessPreferences, setAccessPreference } from './preferences.js';
import { onSettings, settings } from '../ui/settings.js';
import './accessible-page.css';

const sections: readonly [HubPage, string][] = [
  ['home', 'Inicio'], ['fit', 'Mi espacio'], ['input', 'Controles'], ['sound', 'Sonido'], ['vision', 'Lectura'],
  ['communication', 'Comunicación'], ['steps', 'Paso a paso'], ['tasks', 'Mis tareas'], ['consultation', 'Preparar consulta'],
  ['memory', 'Mi memoria'], ['help', 'Ayuda'], ['clinical', 'Planes profesionales'], ['privacy', 'Privacidad'],
  ['library', 'Funciones'], ['share', 'Compartir'], ['energy', 'Mi ritmo'],
];

let mountSequence = 0;
type FieldControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
interface FieldNode { wrapper: HTMLDivElement; label: HTMLLabelElement; control: FieldControl; hint: HTMLParagraphElement; type: HubField['type']; model: string; dirty: boolean; listeners: AbortController }
interface FormNode { element: HTMLFormElement; title: HTMLHeadingElement; description: HTMLParagraphElement; fields: HTMLDivElement; controls: Map<string, FieldNode>; submit: HTMLButtonElement; error: HTMLParagraphElement; current: HubForm; pending: boolean; listeners: AbortController }

/** Native controls, Unicode text and the exact same actions/state as the immersive view. */
export function mountAccessiblePage(presenter: HubPresenter): { setImmersive(active: boolean): void; dispose(): void } {
  const prefix = `sd-access-${++mountSequence}`;
  const listeners = new AbortController();
  const root = document.createElement('div');
  root.className = 'sd-access-root';
  const launcher = button('Accesibilidad', 'sd-access-launcher');
  launcher.id = `${prefix}-launcher`;
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-controls', `${prefix}-dialog`);
  launcher.setAttribute('aria-expanded', 'false');
  const dialog = document.createElement('dialog');
  dialog.id = `${prefix}-dialog`;
  dialog.className = 'sd-access-dialog';
  dialog.setAttribute('aria-labelledby', `${prefix}-title`);
  dialog.setAttribute('aria-describedby', `${prefix}-summary`);
  dialog.setAttribute('aria-modal', 'true');
  dialog.hidden = true;
  const header = document.createElement('header');
  header.className = 'sd-access-header';
  const title = document.createElement('h2');
  title.id = `${prefix}-title`;
  title.tabIndex = -1;
  const close = button('Cerrar', 'sd-access-close');
  close.setAttribute('aria-label', 'Cerrar el centro de accesibilidad');
  header.append(title, close);
  const nav = document.createElement('nav');
  nav.className = 'sd-access-nav';
  nav.setAttribute('aria-label', 'Secciones del centro de accesibilidad');
  nav.setAttribute('role', 'tablist');
  const tabs = new Map<HubPage, HTMLButtonElement>();
  const panel = document.createElement('section');
  panel.id = `${prefix}-panel`;
  panel.className = 'sd-access-panel';
  panel.setAttribute('role', 'tabpanel');
  const summary = paragraph('sd-access-summary');
  summary.id = `${prefix}-summary`;
  const status = paragraph('sd-access-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const failure = paragraph('sd-access-error');
  failure.setAttribute('role', 'alert');
  failure.hidden = true;
  const progressBox = document.createElement('div');
  progressBox.className = 'sd-access-progress';
  const progressLabel = paragraph('sd-access-progress-label');
  const progressBar = document.createElement('progress');
  progressBar.setAttribute('aria-label', 'Pasos completados');
  progressBox.append(progressLabel, progressBar);
  const actionBox = document.createElement('div');
  actionBox.className = 'sd-access-actions';
  const formBox = document.createElement('div');
  formBox.className = 'sd-access-forms';
  const caption = paragraph('sd-access-caption');
  caption.setAttribute('role', 'status');
  caption.setAttribute('aria-label', 'Transcripción');
  caption.setAttribute('aria-live', 'polite');
  const reveal = button('Mostrar mis detalles', 'sd-access-reveal');
  reveal.hidden = true;
  const footer = document.createElement('footer');
  footer.className = 'sd-access-footer';
  const back = button('Atrás', 'sd-access-back');
  const pageLabel = paragraph('sd-access-pagination');
  const next = button('Más opciones', 'sd-access-next');
  footer.append(back, pageLabel, next);
  panel.append(summary, status, failure, progressBox, reveal, actionBox, formBox, caption, footer);
  dialog.append(header, nav, panel);
  root.append(launcher, dialog);
  (document.body ?? document.documentElement).append(root);

  const actions = new Map<string, HubAction>();
  const actionNodes = new Map<string, { button: HTMLButtonElement; label: HTMLSpanElement; detail: HTMLSpanElement; listeners: AbortController }>();
  const forms = new Map<string, FormNode>();
  const pendingActions = new Set<string>();
  let controlSequence = 0;
  let immersive = false;
  let disposed = false;
  let wasVisible = false;
  let wasPresentation = false;
  let localError = '';

  const on = (element: EventTarget, type: string, listener: EventListener, owner = listeners) => element.addEventListener(type, listener, { signal: owner.signal });
  for (const [page, label] of sections) {
    const tab = button(label, 'sd-access-tab');
    tab.id = `${prefix}-tab-${page}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    on(tab, 'click', () => { localError = ''; presenter.open(page); });
    on(tab, 'keydown', event => {
      const key = (event as KeyboardEvent).key;
      const index = sections.findIndex(([candidate]) => candidate === page);
      const move = key === 'ArrowRight' ? (index + 1) % sections.length : key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : key === 'Home' ? 0 : key === 'End' ? sections.length - 1 : -1;
      if (move < 0) return;
      event.preventDefault();
      const target = tabs.get(sections[move][0]);
      target?.focus();
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    tabs.set(page, tab);
    nav.append(tab);
  }

  on(launcher, 'click', () => presenter.open());
  on(close, 'click', () => presenter.close());
  on(back, 'click', () => { localError = ''; presenter.back(); });
  on(next, 'click', () => { localError = ''; presenter.nextPage(); });
  on(reveal, 'click', () => { setAccessPreference('presentationMode', false); });
  on(dialog, 'cancel', event => { event.preventDefault(); presenter.close(); });
  on(dialog, 'close', () => {
    if (!disposed && !immersive && !dialog.open && presenter.getView().isOpen) presenter.close();
  });
  on(dialog, 'keydown', event => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === 'Escape') { event.preventDefault(); event.stopPropagation(); presenter.close(); return; }
    if (keyboard.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')]
      .filter(element => !element.closest('[hidden]') && element.getClientRects().length > 0);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); title.focus(); }
    else if (keyboard.shiftKey && (document.activeElement === first || document.activeElement === title)) { event.preventDefault(); last.focus(); }
    else if (!keyboard.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  function clearPrivateContent(): void {
    for (const record of forms.values()) removeForm(record);
    for (const record of actionNodes.values()) { record.listeners.abort(); record.label.textContent = record.detail.textContent = ''; record.button.remove(); }
    forms.clear();
    actions.clear();
    actionNodes.clear();
    actionBox.replaceChildren();
    formBox.replaceChildren();
    summary.textContent = status.textContent = caption.textContent = progressLabel.textContent = '';
    failure.textContent = '';
  }

  function renderActions(view: HubView): void {
    const wanted = new Set<string>();
    let position = 0;
    for (const action of view.items) {
      if (wanted.has(action.key)) continue;
      wanted.add(action.key);
      actions.set(action.key, action);
      let record = actionNodes.get(action.key);
      if (!record) {
        const node = button('', 'sd-access-action');
        const label = document.createElement('span'), detail = document.createElement('span');
        label.className = 'sd-access-action-label';
        detail.className = 'sd-access-action-detail';
        node.append(label, detail);
        record = { button: node, label, detail, listeners: new AbortController() };
        actionNodes.set(action.key, record);
        on(node, 'click', () => { void executeAction(action.key); }, record.listeners);
      }
      setText(record.label, action.label);
      setText(record.detail, action.detail ?? '');
      record.detail.hidden = !action.detail;
      record.button.disabled = action.disabled === true;
      record.button.setAttribute('aria-disabled', String(action.disabled === true || pendingActions.has(action.key)));
      record.button.setAttribute('aria-busy', String(pendingActions.has(action.key)));
      place(actionBox, record.button, position++);
    }
    for (const [key, record] of actionNodes) if (!wanted.has(key)) { record.listeners.abort(); record.label.textContent = record.detail.textContent = ''; record.button.remove(); actionNodes.delete(key); actions.delete(key); }
  }

  async function executeAction(key: string): Promise<void> {
    const action = actions.get(key);
    if (!action || action.disabled || pendingActions.has(key) || immersive || disposed) return;
    pendingActions.add(key);
    localError = '';
    render();
    try { await action.run(); }
    catch { localError = 'No se pudo completar la acción. Revisa el estado antes de volver a intentarlo.'; }
    finally { pendingActions.delete(key); if (!disposed) render(); }
  }

  function createField(field: HubField): FieldNode {
    const wrapper = document.createElement('div');
    wrapper.className = 'sd-access-field';
    const label = document.createElement('label');
    const control = field.type === 'textarea' ? document.createElement('textarea') : field.type === 'select' ? document.createElement('select') : document.createElement('input');
    control.id = `${prefix}-field-${++controlSequence}`;
    control.name = field.id;
    control.setAttribute('dir', 'auto');
    if (control instanceof HTMLInputElement) {
      control.type = field.type;
      control.autocomplete = field.type === 'password' ? 'new-password' : 'off';
      if (field.type === 'password') { control.spellcheck = false; control.setAttribute('autocapitalize', 'none'); }
    }
    if (control instanceof HTMLTextAreaElement) control.rows = 4;
    const hint = paragraph('sd-access-field-hint');
    hint.id = `${control.id}-hint`;
    control.setAttribute('aria-describedby', hint.id);
    label.htmlFor = control.id;
    wrapper.append(label, control, hint);
    const record: FieldNode = { wrapper, label, control, hint, type: field.type, model: '', dirty: false, listeners: new AbortController() };
    on(control, 'input', () => { record.dirty = true; control.setCustomValidity(''); }, record.listeners);
    on(control, 'change', () => { record.dirty = true; control.setCustomValidity(''); }, record.listeners);
    return record;
  }

  function renderForms(view: HubView): void {
    const wantedForms = new Set<string>();
    let formPosition = 0;
    for (const form of view.forms) {
      if (wantedForms.has(form.id)) continue;
      wantedForms.add(form.id);
      let record = forms.get(form.id);
      if (!record) {
        const element = document.createElement('form');
        element.className = 'sd-access-form';
        const formTitle = document.createElement('h3'), description = paragraph('sd-access-form-description'), fields = document.createElement('div');
        formTitle.id = `${prefix}-form-${++controlSequence}`;
        element.setAttribute('aria-labelledby', formTitle.id);
        fields.className = 'sd-access-fields';
        const submit = button(form.submitLabel, 'sd-access-submit');
        submit.type = 'submit';
        const error = paragraph('sd-access-error');
        error.setAttribute('role', 'alert');
        error.hidden = true;
        record = { element, title: formTitle, description, fields, controls: new Map(), submit, error, current: form, pending: false, listeners: new AbortController() };
        forms.set(form.id, record);
        element.append(formTitle, description, fields, error, submit);
        const stable = record;
        on(element, 'submit', event => { event.preventDefault(); void submitForm(stable); }, record.listeners);
      }
      record.current = form;
      setText(record.title, form.title);
      setText(record.description, form.description ?? '');
      record.description.hidden = !form.description;
      record.submit.textContent = record.pending ? 'Guardando…' : form.submitLabel;
      record.submit.setAttribute('aria-disabled', String(record.pending));
      record.element.setAttribute('aria-busy', String(record.pending));
      const wantedFields = new Set<string>();
      let fieldPosition = 0;
      for (const field of form.fields) {
        if (wantedFields.has(field.id)) continue;
        wantedFields.add(field.id);
        let fieldNode = record.controls.get(field.id);
        if (fieldNode && fieldNode.type !== field.type) { removeField(fieldNode); record.controls.delete(field.id); fieldNode = undefined; }
        if (!fieldNode) { fieldNode = createField(field); record.controls.set(field.id, fieldNode); }
        const control = fieldNode.control;
        setText(fieldNode.label, `${field.label}${field.required ? ' (obligatorio)' : ''}`);
        control.required = field.required === true;
        const limit = fieldLimit(field);
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.maxLength = limit;
        setText(fieldNode.hint, field.type === 'select' || field.type === 'date' || field.type === 'datetime-local' ? '' : `Máximo ${limit} caracteres.`);
        fieldNode.hint.hidden = !fieldNode.hint.textContent;
        if (control instanceof HTMLSelectElement) syncOptions(control, field.options ?? []);
        const model = field.type === 'password' ? '' : field.value ?? '';
        if (!fieldNode.dirty || control.value === model) { if (control.value !== model) control.value = model; fieldNode.dirty = false; }
        fieldNode.model = model;
        place(record.fields, fieldNode.wrapper, fieldPosition++);
      }
      for (const [key, field] of record.controls) if (!wantedFields.has(key)) { removeField(field); record.controls.delete(key); }
      place(formBox, record.element, formPosition++);
    }
    for (const [key, form] of forms) if (!wantedForms.has(key)) {
      removeForm(form);
      forms.delete(key);
    }
  }

  async function submitForm(record: FormNode): Promise<void> {
    if (record.pending || immersive || disposed || forms.get(record.current.id) !== record) return;
    const submitted = record.current;
    const values = Object.create(null) as Record<string, string>;
    let invalid = false;
    for (const field of submitted.fields) {
      const control = record.controls.get(field.id)?.control;
      if (!control) continue;
      if (control.value.length > fieldLimit(field)) { control.setCustomValidity('El texto supera el límite de este campo.'); invalid = true; }
      if (field.type === 'select' && !field.options?.some(option => option.value === control.value) && control.value !== '') { control.setCustomValidity('Selecciona una opción disponible.'); invalid = true; }
      values[field.id] = control.value;
    }
    if (invalid || !record.element.reportValidity()) { record.element.reportValidity(); return; }
    record.pending = true;
    record.error.hidden = true;
    for (const field of record.controls.values()) if (field.type === 'password') { field.control.value = ''; field.dirty = false; }
    render();
    try { await submitted.submit(values); }
    catch {
      record.error.textContent = 'No se pudo completar el formulario. Revisa el estado antes de intentarlo de nuevo.';
      record.error.hidden = false;
    } finally {
      for (const field of submitted.fields) if (field.type === 'password') values[field.id] = '';
      record.pending = false;
      if (!disposed) render();
    }
  }

  function render(): void {
    if (disposed) return;
    const view = presenter.getView();
    root.classList.toggle('sd-access-high-contrast', settings.highContrast);
    root.classList.toggle('sd-access-reduced-motion', accessPreferences.reducedMotion);
    root.classList.toggle('sd-access-presentation', accessPreferences.presentationMode);
    root.style.setProperty('--sd-access-scale', String(accessPreferences.readingScale));
    root.style.setProperty('--sd-access-caption-scale', String(accessPreferences.captionSize));
    launcher.hidden = immersive;
    launcher.setAttribute('aria-expanded', String(view.isOpen && !immersive));
    const visible = view.isOpen && !immersive;
    if (!visible) {
      if (dialog.open) dialog.close();
      dialog.hidden = true;
      for (const form of forms.values()) for (const field of form.controls.values()) if (field.type === 'password') { field.control.value = ''; field.dirty = false; }
      if (!view.isOpen) { clearPrivateContent(); localError = ''; }
      if (wasVisible && !immersive) launcher.focus();
      wasVisible = false;
      return;
    }
    const focused = document.activeElement;
    const focusedInside = focused instanceof HTMLElement && dialog.contains(focused);
    const selection = (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) && focused.selectionStart !== null
      ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : null;
    const presentation = accessPreferences.presentationMode;
    if (presentation && !wasPresentation) clearPrivateContent();
    setText(title, presentation ? 'Centro de accesibilidad' : view.title);
    setText(summary, presentation ? 'Modo presentación: los detalles personales y formularios están ocultos.' : view.summary);
    setText(status, presentation ? '' : view.notice);
    status.hidden = !status.textContent;
    setText(failure, presentation ? '' : localError);
    failure.hidden = !failure.textContent;
    const selected = tabs.get(view.page) ?? tabs.get('home')!;
    panel.setAttribute('aria-labelledby', selected.id);
    for (const [page, tab] of tabs) { tab.setAttribute('aria-selected', String(page === view.page)); tab.tabIndex = page === view.page ? 0 : -1; }
    reveal.hidden = !presentation;
    actionBox.hidden = formBox.hidden = presentation;
    progressBox.hidden = presentation || !view.progress;
    if (!presentation) {
      if (view.progress) {
        const total = integer(view.progress.total), complete = Math.min(total, integer(view.progress.completed)), skipped = Math.min(total, integer(view.progress.skipped));
        progressLabel.textContent = `Completados: ${complete}. Omitidos: ${skipped}. Total: ${total}.`;
        progressBar.max = Math.max(1, total);
        progressBar.value = complete;
        progressBar.setAttribute('aria-valuetext', `${complete} de ${total} completados; ${skipped} omitidos`);
      }
      renderActions(view);
      renderForms(view);
    }
    setText(caption, presentation ? '' : view.caption);
    caption.hidden = !caption.textContent;
    const count = Math.max(1, integer(view.pageCount)), index = Math.min(count - 1, integer(view.pageIndex));
    pageLabel.textContent = `Página ${index + 1} de ${count}`;
    pageLabel.hidden = count === 1;
    next.hidden = count <= 1;
    back.hidden = view.page === 'home' && index === 0;
    dialog.hidden = false;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!wasVisible || (focusedInside && (!focused.isConnected || focused.closest('[hidden]')))) title.focus();
    else if (focusedInside && focused instanceof HTMLElement) {
      if (document.activeElement !== focused) focused.focus({ preventScroll: true });
      if (selection && (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) focused.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
    }
    wasVisible = true;
    wasPresentation = presentation;
  }

  const unsubscribe = presenter.subscribe(render);
  const unsubscribePreferences = onAccessPreferences(render);
  const unsubscribeSettings = onSettings(render);
  render();

  return {
    setImmersive(active: boolean): void { immersive = active; render(); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe(); unsubscribePreferences(); unsubscribeSettings(); listeners.abort();
      clearPrivateContent();
      if (dialog.open) dialog.close();
      root.remove();
    },
  };
}

function removeField(field: FieldNode): void { field.listeners.abort(); field.control.value = ''; field.model = ''; field.label.textContent = field.hint.textContent = ''; field.wrapper.remove(); }
function removeForm(form: FormNode): void { form.listeners.abort(); for (const field of form.controls.values()) removeField(field); form.controls.clear(); form.title.textContent = form.description.textContent = ''; form.element.remove(); }
function place(parent: HTMLElement, element: HTMLElement, position: number): void { if (parent.children[position] !== element) parent.insertBefore(element, parent.children[position] ?? null); }

function button(text: string, className: string): HTMLButtonElement { const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = text; return node; }
function paragraph(className: string): HTMLParagraphElement { const node = document.createElement('p'); node.className = className; node.setAttribute('dir', 'auto'); return node; }
function setText(element: HTMLElement, text: string): void { if (element.textContent !== text) element.textContent = text; }
function integer(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function fieldLimit(field: HubField): number { return Number.isInteger(field.maxLength) && field.maxLength! > 0 ? Math.min(64000, field.maxLength!) : field.type === 'textarea' ? 4000 : field.type === 'password' ? 256 : field.type === 'date' || field.type === 'datetime-local' ? 64 : 500; }
function syncOptions(select: HTMLSelectElement, options: NonNullable<HubField['options']>): void {
  const selected = select.value;
  const existing = new Map([...select.options].map(option => [option.value, option]));
  const wanted = new Set<string>();
  let position = 0;
  for (const choice of options) {
    if (wanted.has(choice.value)) continue;
    wanted.add(choice.value);
    const option = existing.get(choice.value) ?? document.createElement('option');
    option.value = choice.value;
    setText(option, choice.label);
    place(select, option, position++);
  }
  for (const option of [...select.options]) if (!wanted.has(option.value)) option.remove();
  select.value = wanted.has(selected) ? selected : '';
}
