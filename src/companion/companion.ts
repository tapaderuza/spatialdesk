/**
 * The companion page (companion.html, also /?mode=companion): a calm 2D view for a family member or carer outside the
 * headset. They type the code the owner's headset shows, the owner allows it, and then they see the Today board (the card
 * titles the owner chose to share, nothing else) and can press one very large button, Help / Recalibrate, which opens the
 * guided setup in the owner's headset. It talks to the helper API only (src/assist/api.ts): it does not load the XR world.
 *
 * Plain DOM built with textContent (card titles are other people's text, never HTML), a poll every two seconds, large
 * targets, both colour schemes, no motion unless allowed. English first; Spanish with ?lang=es-ES.
 */
import './companion.css';
import { AssistError, assistApi, createSession, type HelpState, type JoinResult, type SharedTask } from '../assist/api.js';
import { isSpanish } from '../i18n/language.js';

const SESSION_KEY = 'spatialdesk.companion.session';
const PAIR_KEY = 'spatialdesk.companion.pair';
const POLL_MS = 2_000;
const HIDDEN_POLL_MS = 6_000;
const FAILING_POLL_MS = 5_000;
/** A call for help still unanswered after this long: say so plainly (the headset may be off or in the background). */
const STALE_HELP_MS = 30_000;

const TEXT = {
  en: {
    title: 'SpatialDesk Companion',
    online: 'Connected',
    reconnecting: 'Reconnecting...',
    codeLabel: 'Code from their headset',
    codeHint: 'In the headset say "Invite a helper", or press "Invite a family member or carer" on the start screen. The code lasts two minutes.',
    connect: 'Connect',
    waitingTitle: 'Waiting for them to allow it',
    waitingText: 'Ask them to press Allow in their headset. You will see nothing until they do.',
    cancel: 'Cancel',
    boardTitle: 'Today board',
    justNow: 'Updated just now',
    ago: (seconds: number) => `Updated ${seconds} s ago`,
    empty: 'No cards shared yet.',
    cards: (n: number) => `${n} card${n === 1 ? '' : 's'}`,
    help: 'Help / Recalibrate',
    helpSub: 'Opens the setup in their headset',
    helpStatus: {
      idle: 'They can skip any step of it.',
      pending: 'Sent. Waiting for their headset...',
      shown: 'Their headset is showing the setup now. They can skip any step.',
      done: 'They finished the setup.',
      dismissed: 'They skipped it. You can send it again.',
      stale: 'Still waiting. Their headset may be off or in the background.',
      cooldown: 'Wait a few seconds before asking again.',
      limit: 'No more calls for help are allowed in this session.',
      network: 'Network issue. It was not sent. Try again.',
    },
    leave: 'Stop following',
    endedTitle: 'This session has ended',
    endedText: 'The sharing stopped or ran out of time. Ask for a new code if you still want to follow along.',
    newCode: 'Enter a new code',
    errors: {
      invalid: 'Type the 8 characters of the code.',
      invitation_unavailable: 'That code is not valid or has expired. Check it, or ask for a new one.',
      join_limit: 'Too many tries. Wait a minute and try again.',
      owner_cannot_join: 'This is the headset that made the code. Open this page on another device.',
      request_limit: 'This code already has all the requests it allows. Ask for a new one.',
      network: 'Network issue. Check your connection and try again.',
      other: 'That did not work. Ask for a new code.',
    },
  },
  es: {
    title: 'SpatialDesk Acompanante',
    online: 'Conectado',
    reconnecting: 'Reconectando...',
    codeLabel: 'Codigo de sus gafas',
    codeHint: 'En las gafas di "Invitar a un ayudante", o pulsa "Invitar a un familiar o cuidador" en la pantalla de inicio. El codigo dura dos minutos.',
    connect: 'Conectar',
    waitingTitle: 'Esperando a que lo permita',
    waitingText: 'Pidele que pulse Permitir en sus gafas. No veras nada hasta entonces.',
    cancel: 'Cancelar',
    boardTitle: 'Tablero de hoy',
    justNow: 'Actualizado ahora',
    ago: (seconds: number) => `Actualizado hace ${seconds} s`,
    empty: 'Aun no hay tarjetas compartidas.',
    cards: (n: number) => `${n} tarjeta${n === 1 ? '' : 's'}`,
    help: 'Ayuda / Recalibrar',
    helpSub: 'Abre el ajuste en sus gafas',
    helpStatus: {
      idle: 'Puede saltar cualquier paso.',
      pending: 'Enviado. Esperando a sus gafas...',
      shown: 'Sus gafas muestran el ajuste ahora. Puede saltar cualquier paso.',
      done: 'Termino el ajuste.',
      dismissed: 'Lo salto. Puedes enviarlo de nuevo.',
      stale: 'Sigue esperando. Puede que las gafas esten apagadas o en segundo plano.',
      cooldown: 'Espera unos segundos antes de volver a pedirlo.',
      limit: 'No se permiten mas llamadas de ayuda en esta sesion.',
      network: 'Problema de red. No se envio. Prueba otra vez.',
    },
    leave: 'Dejar de seguir',
    endedTitle: 'Esta sesion ha terminado',
    endedText: 'Se dejo de compartir o se acabo el tiempo. Pide un codigo nuevo si quieres seguir.',
    newCode: 'Escribir otro codigo',
    errors: {
      invalid: 'Escribe los 8 caracteres del codigo.',
      invitation_unavailable: 'Ese codigo no es valido o ha caducado. Revisalo o pide uno nuevo.',
      join_limit: 'Demasiados intentos. Espera un minuto y prueba otra vez.',
      owner_cannot_join: 'Estas gafas son las que crearon el codigo. Abre esta pagina en otro dispositivo.',
      request_limit: 'Este codigo ya tiene todas las solicitudes que permite. Pide uno nuevo.',
      network: 'Problema de red. Revisa tu conexion y prueba otra vez.',
      other: 'No funciono. Pide un codigo nuevo.',
    },
  },
} as const;

type Stage = 'code' | 'waiting' | 'live' | 'ended';
type HelpKey = keyof (typeof TEXT)['en']['helpStatus'];
type ErrorKey = keyof (typeof TEXT)['en']['errors'];
interface Help { id: string; state: HelpState; since: number }
interface Pair { pairId: string; requestId: string }

const t = () => (isSpanish() ? TEXT.es : TEXT.en);
const root = document.getElementById('app')!;
document.documentElement.lang = isSpanish() ? 'es' : 'en';
document.title = t().title;

let stage: Stage = 'code';
let session = read(SESSION_KEY);
let pair: Pair | null = parse(read(PAIR_KEY));
let tasks: SharedTask[] = [];
let online = true;
let lastUpdate = 0;
let help: Help | null = null;
let helpNote: HelpKey | null = null;
let timer: number | undefined;
let failures = 0;
let polling = false;

// Nodes the poll updates in place (rebuilt by each stage's screen).
const ui: { pill?: HTMLElement; pillText?: HTMLElement; board?: HTMLElement; updated?: HTMLElement; helpButton?: HTMLButtonElement; helpStatus?: HTMLElement; error?: HTMLElement } = {};

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* private mode: a reload starts again at the code */
  }
}
function parse(json: string | null): Pair | null {
  try {
    const value = json ? (JSON.parse(json) as Pair) : null;
    return value && typeof value.pairId === 'string' && typeof value.requestId === 'string' ? value : null;
  } catch {
    return null;
  }
}

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'role'>> & { class?: string; role?: string; data?: Record<string, string>; aria?: Record<string, string> };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, role, data, aria, ...rest } = props;
  if (className) node.className = className;
  if (role) node.setAttribute('role', role);
  Object.assign(node, rest);
  for (const [key, value] of Object.entries(data ?? {})) node.dataset[key] = value;
  for (const [key, value] of Object.entries(aria ?? {})) node.setAttribute(`aria-${key}`, value);
  node.append(...children);
  return node;
}

function header(): HTMLElement {
  const text = el('span', { id: 'status-text' }, t().online);
  const pill = el('span', { class: 'pill', id: 'status', data: { online: 'true' }, aria: { live: 'polite' } }, el('span', { class: 'dot', aria: { hidden: 'true' } }), text);
  ui.pill = pill;
  ui.pillText = text;
  return el('header', {}, el('h1', {}, t().title), pill);
}

function paintPill(): void {
  if (!ui.pill || !ui.pillText) return;
  ui.pill.dataset.online = String(online);
  ui.pillText.textContent = online ? t().online : t().reconnecting;
}

function show(next: Stage): void {
  stage = next;
  Object.keys(ui).forEach((key) => delete (ui as Record<string, unknown>)[key]);
  root.replaceChildren(header(), screen());
  // There is a connection to speak of only once a code has been typed: no "Connected" over an empty form.
  if (ui.pill) ui.pill.hidden = stage === 'code' || stage === 'ended';
  paintPill();
  root.querySelector<HTMLElement>('h2, input')?.focus();
}

function screen(): HTMLElement {
  switch (stage) {
    case 'code':
      return codeScreen();
    case 'waiting':
      return waitingScreen();
    case 'live':
      return liveScreen();
    default:
      return endedScreen();
  }
}

function codeScreen(): HTMLElement {
  const input = el('input', { type: 'text', id: 'code', name: 'code', autocomplete: 'off', maxLength: 9, spellcheck: false, inputMode: 'text' });
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('aria-describedby', 'code-hint code-error');
  const preset = new URLSearchParams(location.search).get('code');
  if (preset) input.value = preset.slice(0, 9);
  const error = el('p', { class: 'error', id: 'code-error', role: 'alert' });
  ui.error = error;
  const form = el(
    'form',
    { class: 'card', id: 'join' },
    el('label', { htmlFor: 'code' }, t().codeLabel),
    input,
    el('p', { class: 'dim', id: 'code-hint' }, t().codeHint),
    error,
    el('button', { type: 'submit', class: 'primary', id: 'connect' }, t().connect),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void connect(input.value);
  });
  return form;
}

function waitingScreen(): HTMLElement {
  const cancel = el('button', { type: 'button', id: 'cancel' }, t().cancel);
  cancel.addEventListener('click', leave);
  return el('section', { class: 'card', aria: { live: 'polite' } }, el('h2', { tabIndex: -1 }, t().waitingTitle), el('p', { class: 'dim' }, t().waitingText), cancel);
}

function liveScreen(): HTMLElement {
  const updated = el('p', { class: 'dim', id: 'updated' });
  const board = el('div', { class: 'board', id: 'board' });
  const button = el('button', { type: 'button', class: 'help', id: 'help' }, t().help, el('small', {}, t().helpSub));
  const status = el('p', { class: 'status', id: 'help-status', role: 'status', aria: { live: 'polite' } });
  button.addEventListener('click', () => void askForHelp());
  const stop = el('button', { type: 'button', id: 'leave' }, t().leave);
  stop.addEventListener('click', leave);
  Object.assign(ui, { board, updated, helpButton: button, helpStatus: status });
  paintBoard();
  paintHelp();
  return el('div', { class: 'stack' }, el('section', { class: 'card' }, el('h2', { tabIndex: -1 }, t().boardTitle), updated, board), button, status, el('div', { class: 'row' }, stop));
}

function endedScreen(): HTMLElement {
  const again = el('button', { type: 'button', class: 'primary', id: 'again' }, t().newCode);
  again.addEventListener('click', () => show('code'));
  return el('section', { class: 'card', aria: { live: 'polite' } }, el('h2', { tabIndex: -1 }, t().endedTitle), el('p', { class: 'dim' }, t().endedText), again);
}

/** The board: columns in the order they first appear, each card as plain text. */
function paintBoard(): void {
  const { board, updated } = ui;
  if (!board || !updated) return;
  const columns = new Map<string, string[]>();
  for (const task of tasks) columns.set(task.column, [...(columns.get(task.column) ?? []), task.title]);
  const names = [...columns.keys()];
  if (names.length === 0) {
    board.replaceChildren(el('p', { class: 'dim' }, t().empty));
  } else {
    board.replaceChildren(
      ...names.map((name, index) =>
        el(
          'section',
          { class: 'column', aria: { label: name } },
          el('h3', {}, el('span', {}, name), el('span', { class: 'dim' }, t().cards(columns.get(name)!.length))),
          el('ul', {}, ...columns.get(name)!.map((title) => el('li', { data: { done: String(names.length > 1 && index === names.length - 1) } }, title))),
        ),
      ),
    );
  }
  paintUpdated();
}

function paintUpdated(): void {
  if (!ui.updated) return;
  const seconds = Math.max(0, Math.round((Date.now() - lastUpdate) / 1000));
  ui.updated.textContent = seconds < 3 ? t().justNow : t().ago(seconds);
}

function paintHelp(): void {
  const { helpButton, helpStatus } = ui;
  if (!helpButton || !helpStatus) return;
  helpButton.disabled = help !== null && (help.state === 'pending' || help.state === 'shown');
  let key: HelpKey = 'idle';
  if (helpNote) key = helpNote;
  else if (help) key = help.state === 'pending' && Date.now() - help.since > STALE_HELP_MS ? 'stale' : help.state;
  helpStatus.textContent = t().helpStatus[key];
  helpStatus.dataset.tone = key === 'done' || key === 'shown' ? 'good' : key === 'idle' || key === 'pending' ? '' : 'warn';
}

async function ensureSession(): Promise<string> {
  if (!session) {
    session = await createSession();
    write(SESSION_KEY, session);
  }
  return session;
}

async function connect(raw: string): Promise<void> {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const fail = (key: ErrorKey) => {
    if (ui.error) ui.error.textContent = t().errors[key];
  };
  if (code.length !== 8) return fail('invalid');
  const button = root.querySelector<HTMLButtonElement>('#connect');
  if (button) button.disabled = true;
  try {
    let joined: JoinResult;
    try {
      joined = await assistApi.join(await ensureSession(), code);
    } catch (error) {
      if (!(error instanceof AssistError) || error.code !== 'session_expired') throw error;
      session = null; // the server forgot this browser: a fresh session, and one more try
      joined = await assistApi.join(await ensureSession(), code);
    }
    pair = { pairId: joined.pairId, requestId: joined.requestId };
    write(PAIR_KEY, JSON.stringify(pair));
    failures = 0;
    online = true;
    help = null;
    helpNote = null;
    show(joined.state === 'approved' ? 'live' : 'waiting');
    schedule(0);
  } catch (error) {
    const key: ErrorKey = error instanceof AssistError ? (error.status === 0 ? 'network' : error.code in t().errors ? (error.code as ErrorKey) : 'other') : 'other';
    fail(key);
    if (button) button.disabled = false;
  }
}

async function askForHelp(): Promise<void> {
  if (!pair || !session || ui.helpButton?.disabled) return;
  ui.helpButton!.disabled = true;
  try {
    const result = await assistApi.requestHelp(session, pair.pairId);
    help = { id: result.helpId, state: result.state, since: Date.now() };
    helpNote = null;
  } catch (error) {
    if (error instanceof AssistError && error.status !== 0) {
      if (error.code === 'help_cooldown') helpNote = 'cooldown';
      else if (error.code === 'help_limit') helpNote = 'limit';
      else return end(); // the room is gone, or this helper is no longer approved
    } else {
      helpNote = 'network';
    }
  }
  paintHelp();
}

function leave(): void {
  stopPolling();
  pair = null;
  tasks = [];
  help = null;
  write(PAIR_KEY, null);
  show('code');
}

function end(): void {
  stopPolling();
  pair = null;
  write(PAIR_KEY, null);
  show('ended');
}

function stopPolling(): void {
  window.clearTimeout(timer);
  timer = undefined;
}

function schedule(delay: number): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void poll(), delay);
}

async function poll(): Promise<void> {
  if (!pair || !session || polling) return;
  polling = true;
  try {
    const view = await assistApi.helper(session, pair.pairId);
    failures = 0;
    online = true;
    lastUpdate = Date.now();
    if (view.approved) {
      tasks = view.tasks ?? [];
      if (view.help) {
        const same = help?.id === view.help.helpId;
        help = { id: view.help.helpId, state: view.help.state, since: same ? help!.since : Date.now() };
        if (same || view.help.state !== 'pending') helpNote = null;
      }
      if (stage !== 'live') show('live');
      else {
        paintBoard();
        paintHelp();
      }
    } else if (stage !== 'waiting') {
      show('waiting');
    }
    paintPill();
  } catch (error) {
    if (error instanceof AssistError && error.status === 0) {
      failures++;
      online = false;
      paintPill();
    } else {
      return end(); // the room is gone, or this browser's session is: the sharing has ended
    }
  } finally {
    polling = false;
  }
  if (pair) schedule(failures > 2 ? FAILING_POLL_MS : document.hidden ? HIDDEN_POLL_MS : POLL_MS);
}

// "Updated 5 s ago" keeps counting between polls; coming back to the tab refreshes at once.
window.setInterval(() => {
  if (stage === 'live') {
    paintUpdated();
    paintHelp(); // a call that has waited too long says so
  }
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pair) schedule(0);
});

// A tab reloaded in the middle of a session picks it up again; if the room is gone it falls back to the code.
if (pair && session) {
  show('waiting');
  void poll();
} else {
  show('code');
}
