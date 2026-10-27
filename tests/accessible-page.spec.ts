import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Win = Window & Record<string, any>;
const compile = (file: string) => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const accessibleSource = compile('src/accessibility/accessible-page.ts').replace(/^import\s+['"]\.\/accessible-page\.css['"];?\s*$/m, '');
const preferencesSource = compile('src/accessibility/preferences.ts');
const styles = readFileSync('src/accessibility/accessible-page.css', 'utf8');

async function mount(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:4173/accessible-page-test', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><title>Accessible view test</title><button id="outside">Otra parte de la aplicación</button></html>' }));
  await page.goto('http://127.0.0.1:4173/accessible-page-test');
  await page.addStyleTag({ content: styles });
  await page.evaluate(async ({ source, preferences }) => {
    const w = window as Win;
    const prefsUrl = URL.createObjectURL(new Blob([preferences], { type: 'text/javascript' }));
    const settingsUrl = URL.createObjectURL(new Blob([`
      export const settings = {highContrast:false};
      const listeners = new Set();
      export function onSettings(fn) {listeners.add(fn);return ()=>listeners.delete(fn);}
      window.__contrast = value => {settings.highContrast=value;for(const fn of listeners)fn(settings);};
    `], { type: 'text/javascript' }));
    const code = source.replace("'./preferences.js'", JSON.stringify(prefsUrl)).replace("'../ui/settings.js'", JSON.stringify(settingsUrl));
    const sourceUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { mountAccessiblePage } = await import(sourceUrl);
    w.preferences = await import(prefsUrl);
    const listeners = new Set<() => void>();
    const submissions: Record<string, string>[] = [];
    const form = { id: 'example', title: 'Preparar una consulta', description: 'Datos que eliges introducir.', submitLabel: 'Guardar formulario', fields: [
      { id: 'question', label: 'Mi pregunta', type: 'textarea', required: true, maxLength: 80, value: '' },
      { id: 'passphrase', label: 'Frase privada', type: 'password', required: false, maxLength: 128, value: 'no debes precargar este secreto' },
      { id: 'date', label: 'Fecha', type: 'date', required: true, value: '2026-10-27' },
      { id: 'when', label: 'Momento', type: 'datetime-local', required: false, value: '' },
      { id: 'mode', label: 'Formato', type: 'select', required: true, value: 'short', options: [{ value: 'short', label: 'Breve' }, { value: 'long', label: 'Detallado' }] },
    ], submit: async (values: Record<string, string>) => { submissions.push({ ...values }); } };
    let state: any = { isOpen: false, page: 'home', title: 'Mi centro accesible', summary: 'Información elegida por la persona.', notice: '', items: [
      { key: 'example-action', label: 'Acción de ejemplo', detail: 'Una opción verificable.', run: () => { w.actionCalls++; } },
    ], forms: [form], pageIndex: 0, pageCount: 2, caption: 'Texto de la conversación', progress: { completed: 1, skipped: 2, total: 5 } };
    w.actionCalls = 0; w.closeCalls = 0; w.openCalls = []; w.nextCalls = 0; w.backCalls = 0;
    w.fakePresenter = {
      getView: () => state,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      open: (selected?: string) => { w.openCalls.push(selected ?? 'home'); state = { ...state, isOpen: true, page: selected ?? 'home' }; for (const fn of listeners) fn(); },
      close: () => { w.closeCalls++; state = { ...state, isOpen: false }; for (const fn of listeners) fn(); },
      nextPage: () => { w.nextCalls++; state = { ...state, pageIndex: (state.pageIndex + 1) % state.pageCount }; for (const fn of listeners) fn(); },
      back: () => { w.backCalls++; state = { ...state, pageIndex: Math.max(0, state.pageIndex - 1) }; for (const fn of listeners) fn(); },
      patch: (values: any) => { state = { ...state, ...values }; for (const fn of listeners) fn(); },
      form, submissions, listeners,
    };
    w.view = mountAccessiblePage(w.fakePresenter);
    URL.revokeObjectURL(sourceUrl); URL.revokeObjectURL(settingsUrl); // imported modules remain available without retaining source URLs
  }, { source: accessibleSource, preferences: preferencesSource });
}

test.beforeEach(async ({ page }) => mount(page));

test('native dialog, category tabs, keyboard navigation, shared pagination and Escape close', async ({ page }) => {
  await page.getByRole('button', { name: 'Accesibilidad', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mi centro accesible' })).toBeFocused();
  await expect(page.getByRole('tab')).toHaveCount(16);
  await page.getByRole('tab', { name: 'Inicio', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Mi espacio', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as Win).fakePresenter.getView().page)).toBe('fit');
  await expect(page.getByRole('tab', { name: 'Mi espacio', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click();
  expect(await page.evaluate(() => (window as Win).nextCalls)).toBe(1);
  await page.getByRole('button', { name: 'Atrás', exact: true }).click();
  expect(await page.evaluate(() => (window as Win).backCalls)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Accesibilidad', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as Win).closeCalls)).toBe(1);
});

test('forms retain draft text, focus and selection across updates and reordering', async ({ page }) => {
  await page.getByRole('button', { name: 'Accesibilidad', exact: true }).click();
  const question = page.getByLabel('Mi pregunta (obligatorio)', { exact: true });
  await question.fill('¿Cómo continuar mañana? 中文');
  await question.focus();
  await question.evaluate((node: HTMLTextAreaElement) => { node.setSelectionRange(3, 12, 'forward'); (window as Win).originalField = node; });
  await page.evaluate(() => (window as Win).fakePresenter.patch({ notice: 'Estado actualizado' }));
  await expect(question).toBeFocused();
  expect(await question.evaluate((node: HTMLTextAreaElement) => ({ same: node === (window as Win).originalField, start: node.selectionStart, end: node.selectionEnd }))).toEqual({ same: true, start: 3, end: 12 });
  await page.evaluate(() => {
    const p = (window as Win).fakePresenter;
    p.form.fields = [...p.form.fields].reverse();
    p.patch({ forms: [p.form] });
  });
  await expect(question).toHaveValue('¿Cómo continuar mañana? 中文');
  await expect(question).toBeFocused();
  expect(await question.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([3, 12]);
  await expect(page.getByRole('status').filter({ hasText: 'Estado actualizado' })).toBeVisible();
});

test('labels, native field types, validation and password clearing before/after submission', async ({ page }) => {
  await page.getByRole('button', { name: 'Accesibilidad', exact: true }).click();
  const password = page.getByLabel('Frase privada', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue('');
  await expect(page.getByLabel('Fecha (obligatorio)', { exact: true })).toHaveAttribute('type', 'date');
  await expect(page.getByLabel('Momento', { exact: true })).toHaveAttribute('type', 'datetime-local');
  await page.getByRole('button', { name: 'Guardar formulario', exact: true }).click();
  expect(await page.evaluate(() => (window as Win).fakePresenter.submissions.length)).toBe(0);
  await page.getByLabel('Mi pregunta (obligatorio)', { exact: true }).fill('Una pregunta propia');
  await password.fill('Frase que no debe quedar en el campo');
  await page.getByLabel('Formato (obligatorio)', { exact: true }).selectOption('long');
  await page.getByRole('button', { name: 'Guardar formulario', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Win).fakePresenter.submissions.length)).toBe(1);
  expect(await page.evaluate(() => (window as Win).fakePresenter.submissions[0])).toMatchObject({ question: 'Una pregunta propia', passphrase: 'Frase que no debe quedar en el campo', date: '2026-10-27', mode: 'long' });
  await expect(password).toHaveValue('');
  await page.getByLabel('Mi pregunta (obligatorio)', { exact: true }).evaluate((node: HTMLTextAreaElement) => { node.value = 'x'.repeat(81); node.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.getByRole('button', { name: 'Guardar formulario', exact: true }).click();
  expect(await page.evaluate(() => (window as Win).fakePresenter.submissions.length)).toBe(1);
});

test('presentation hides details in the DOM; preferences alter local display without altering presenter state', async ({ page }) => {
  await page.getByRole('button', { name: 'Accesibilidad', exact: true }).click();
  await page.getByLabel('Mi pregunta (obligatorio)', { exact: true }).fill('Nota privada de prueba');
  await page.evaluate(() => {
    const w = window as Win;
    w.fakePresenter.patch({ summary: 'Detalle privado', notice: 'Aviso privado', caption: 'Transcripción privada', items: [{ key: 'private', label: 'Título privado', run() {} }] });
    w.preferences.setAccessPreference('readingScale', 1.4);
    w.preferences.setAccessPreference('reducedMotion', true);
    w.__contrast(true);
    w.preferences.setAccessPreference('presentationMode', true);
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).not.toContainText('Detalle privado');
  await expect(dialog).not.toContainText('Aviso privado');
  await expect(dialog).not.toContainText('Transcripción privada');
  await expect(dialog).not.toContainText('Título privado');
  await expect(dialog.locator('input,textarea,select')).toHaveCount(0);
  await expect(page.locator('.sd-access-root')).toHaveClass(/sd-access-high-contrast/);
  await expect(page.locator('.sd-access-root')).toHaveClass(/sd-access-reduced-motion/);
  expect(await page.locator('.sd-access-root').evaluate(node => (node as HTMLElement).style.getPropertyValue('--sd-access-scale'))).toBe('1.4');
  await page.getByRole('button', { name: 'Mostrar mis detalles', exact: true }).click();
  await expect(dialog).toContainText('Detalle privado');
  expect(await page.evaluate(() => (window as Win).fakePresenter.getView().isOpen)).toBe(true);
});

test('immersive transitions hide the browser UI without closing the shared view; disposal unsubscribes', async ({ page }) => {
  await page.getByRole('button', { name: 'Accesibilidad', exact: true }).click();
  await page.evaluate(() => (window as Win).view.setImmersive(true));
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Accesibilidad', exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => ({ open: (window as Win).fakePresenter.getView().isOpen, closed: (window as Win).closeCalls }))).toEqual({ open: true, closed: 0 });
  await page.evaluate(() => (window as Win).view.setImmersive(false));
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => (window as Win).closeCalls)).toBe(0);
  await page.evaluate(() => { const w = window as Win; w.view.dispose(); w.fakePresenter.open('home'); w.preferences.setAccessPreference('readingScale', 1.1); });
  await expect(page.locator('.sd-access-root')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Win).fakePresenter.listeners.size)).toBe(0);
});

test('progress distinguishes completed from skipped and untrusted strings are rendered as text', async ({ page }) => {
  await page.getByRole('button', { name: 'Accesibilidad', exact: true }).click();
  await expect(page.locator('.sd-access-progress-label')).toHaveText('Completados: 1. Omitidos: 2. Total: 5.');
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1');
  await page.evaluate(() => {
    const p = (window as Win).fakePresenter;
    p.patch({ title: '<img src=x onerror="alert(1)">', summary: '<script>window.bad=true</script>', items: [{ key: 'x', label: '<svg onload="bad()">', detail: '<b>literal</b>', run() {} }] });
  });
  await expect(page.getByRole('dialog').locator('img,script,svg')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('<img src=x onerror="alert(1)">');
  await expect(page.getByRole('dialog')).toContainText('<script>window.bad=true</script>');
});

test('async actions do not run twice and exception text is not disclosed', async ({ page }) => {
  await page.getByRole('button', { name: 'Accesibilidad', exact: true }).click();
  await page.evaluate(() => {
    const w = window as Win;
    w.fakePresenter.patch({ items: [{ key: 'async', label: 'Acción pendiente', run: async () => { w.actionCalls++; await new Promise<void>(resolve => { w.finishAction = resolve; }); throw Error('secreto que no debe mostrarse'); } }] });
  });
  const action = page.getByRole('button', { name: 'Acción pendiente', exact: true });
  await action.click();
  await expect(action).toHaveAttribute('aria-disabled', 'true');
  await action.evaluate((node: HTMLButtonElement) => node.click());
  expect(await page.evaluate(() => (window as Win).actionCalls)).toBe(1);
  await page.evaluate(() => (window as Win).finishAction());
  await expect(page.getByRole('alert')).toContainText('No se pudo completar la acción');
  await expect(page.getByRole('dialog')).not.toContainText('secreto que no debe mostrarse');
  await expect(action).toHaveAttribute('aria-disabled', 'false');
});
