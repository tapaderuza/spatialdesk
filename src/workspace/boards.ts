/**
 * Kanban boards in space. Interaction is pick-and-place, which works the same with a poke, a pinch ray, or a mouse:
 * tap a card to pick it up (every column on every board lights up as a drop target), then tap a column to drop it
 * at the end, or tap a card to drop it in that card's place. Tap the held card again to put it back.
 * Panels are only touched when the workspace or the selection changes, never per frame.
 */
import { createSystem, type UIKit, type UIKitDocument } from '@iwsdk/core';
import { onAccessPreferences } from '../accessibility/preferences.js';
import { boardPresentation, presentationText } from '../accessibility/presentation.js';
import { hoverFades } from '../ui/hover.js';
import { PanelHits } from '../ui/panel-hits.js';
import { idleBorder, onSettings } from '../ui/settings.js';
import { play } from '../ui/sounds.js';
import { BOARD_SIZE, panelText, type Board, type Card, type Workspace } from './model.js';
import { PinnedPanel } from './pinned.js';
import { glidesFor } from '../ui/glide.js';
import { workspace, type ChangeSource } from './store.js';

const COLUMNS = 4; // slots in public/ui/board.uikitml
const CARDS = 4;
const HANDLE_WIDTH = 0.24;
const CONFIG = `${import.meta.env.BASE_URL}ui/board.uikitml`;

// Off-white on dark greys; every text colour >= 7:1 on its background (ROADMAP heuristic B).
const COLOR = {
  column: '#1d222a',
  dropColumn: '#183329',
  dropBorder: '#5ee0a0',
  card: '#2a313b',
  heldCard: '#2f5f9e',
  heldBorder: '#9cc3ff',
  focus: '#2f5f9e',
  mark: { low: '#4c5664', normal: '#7f8b9b', high: '#ff8a7a' },
} as const;

/** Characters that fit two lines of a card (1.9 cm Inter, minutes label beside it), by columns sharing 72 cm. */
const CARD_CHARS = [0, 56, 36, 24, 17] as const;

let held: { boardId: string; cardId: string } | null = null;
let coach: { boardId: string; key: string } | null = null;
let repaintBoards: (() => void) | null = null;
const COACH_BORDER = '#f2b84b';

/** The onboarding coach outlines one card or column ("card-0-0", "col-1") on a board; null clears it. */
export function setCoachTarget(target: { boardId: string; key: string } | null): void {
  coach = target;
  repaintBoards?.();
}

/** The picked-up card, if any (the command panel's Focus 25 times that card). */
export function heldCard(): Card | null {
  if (!held) return null;
  for (const board of workspace.state.boards) {
    for (const column of board.columns) {
      const card = column.cards.find((c) => c.id === held!.cardId);
      if (card) return card;
    }
  }
  return null;
}

/** Drops the selection without moving anything (the next workspace change repaints the boards). */
export function releaseHeld(): void {
  held = null;
}

type Element = UIKit.Text;

interface Slots {
  root: Element;
  title: Element;
  focus: Element;
  columns: {
    box: Element;
    title: Element;
    count: Element;
    more: Element;
    cards: { box: Element; mark: Element; text: Element; min: Element }[];
  }[];
}

class BoardView {
  readonly pinned: PinnedPanel;
  readonly cleanups: (() => void)[] = [];
  private slots: Slots | null = null;
  private readonly hovered = new Set<string>();
  /** First visible page per column, for columns with more cards than slots. */
  private readonly pages = new Array<number>(COLUMNS).fill(0);

  constructor(
    readonly system: BoardSystem,
    readonly id: string,
  ) {
    this.pinned = new PinnedPanel(system.world, id, CONFIG, BOARD_SIZE, HANDLE_WIDTH);
    this.pinned.whenReady((document) => {
      this.slots = bindSlots(document, this);
      this.render();
    });
  }

  board(): Board | undefined {
    return workspace.state.boards.find((b) => b.id === this.id);
  }

  render(): void {
    const board = this.board();
    const slots = this.slots;
    if (!board || !slots) return;
    const content = boardPresentation(board);
    slots.title.setProperties({ text: panelText(content.title) });
    this.paintFocus();

    const maxChars = CARD_CHARS[Math.min(board.columns.length, COLUMNS)];
    slots.columns.forEach((slot, c) => {
      const column = board.columns[c];
      if (!column) {
        slot.box.setProperties({ display: 'none' });
        return;
      }
      const pages = Math.max(1, Math.ceil(column.cards.length / CARDS));
      if (this.pages[c] >= pages) this.pages[c] = 0;
      const first = this.pages[c] * CARDS;
      this.paintColumn(c);
      slot.title.setProperties({ text: panelText(content.columns[c].title) });
      slot.count.setProperties({ text: String(column.cards.length) });
      slot.more.setProperties({
        text: column.cards.length > CARDS ? `${first + 1}-${Math.min(first + CARDS, column.cards.length)} of ${column.cards.length}, tap` : '',
      });
      slot.cards.forEach((cardSlot, k) => {
        const card = column.cards[first + k];
        this.paintCard(c, k);
        if (!card) return;
        cardSlot.mark.setProperties({ backgroundColor: COLOR.mark[card.priority] });
        cardSlot.text.setProperties({ text: fit(panelText(content.columns[c].cards[first + k]), maxChars) });
        cardSlot.min.setProperties({ text: minutesLabel(card) });
      });
    });
  }

  /**
   * Hover is painted here rather than with a UIKitML :hover style, which stays stuck once an element has been
   * restyled at runtime. Pointer enter/leave arrive reliably for mouse, rays and pokes alike.
   */
  setHover(key: string, on: boolean): void {
    if (on) this.hovered.add(key);
    else this.hovered.delete(key);
    const [kind, c, k] = key.split('-');
    if (kind === 'card') this.paintCard(Number(c), Number(k));
    else if (kind === 'col') this.paintColumn(Number(c));
    else if (kind === 'focus') this.paintFocus();
  }

  // Hover is a fade of the control's own colour, never an outline (src/ui/hover.ts); borders carry state only.
  private paintFocus(): void {
    const focus = this.slots?.focus;
    if (!focus) return;
    focus.setProperties({ display: workspace.state.focusBoardId === this.id ? 'none' : 'flex', borderColor: idleBorder(COLOR.focus) });
    hoverFades.paint(focus, COLOR.focus, this.hovered.has('focus'));
  }

  private paintColumn(c: number): void {
    const column = this.board()?.columns[c];
    const box = this.slots?.columns[c].box;
    if (!column || !box) return;
    const dropTarget = held != null && !column.cards.some((card) => card.id === held!.cardId);
    box.setProperties({
      display: 'flex',
      borderColor: dropTarget ? COLOR.dropBorder : this.coached(`col-${c}`) ? COACH_BORDER : idleBorder(COLOR.column),
    });
    hoverFades.paint(box, dropTarget ? COLOR.dropColumn : COLOR.column, this.hovered.has(`col-${c}`), dropTarget ? COLOR.dropBorder : undefined);
  }

  private paintCard(c: number, k: number): void {
    const card = this.board()?.columns[c]?.cards[this.pages[c] * CARDS + k];
    const box = this.slots?.columns[c].cards[k].box;
    if (!box) return;
    if (!card) {
      box.setProperties({ display: 'none' });
      return;
    }
    const isHeld = held?.cardId === card.id;
    box.setProperties({
      display: 'flex',
      borderColor: isHeld ? COLOR.heldBorder : this.coached(`card-${c}-${k}`) ? COACH_BORDER : idleBorder(COLOR.card),
    });
    hoverFades.paint(box, isHeld ? COLOR.heldCard : COLOR.card, this.hovered.has(`card-${c}-${k}`), undefined, true); // a card rises a little when aimed at
  }

  private coached(key: string): boolean {
    return coach != null && coach.boardId === this.id && coach.key === key;
  }

  private isFocus(): boolean {
    return workspace.state.focusBoardId === this.id;
  }

  /**
   * Parked boards are 1.45 m away: a single card there is too small a target for a shaky pinch ray (the synthetic
   * noise test proves it), so a parked board only takes whole-board and whole-column taps. Tapping it brings it
   * within reach; with a card held, a tap drops the card in the column under the ray.
   */
  tapCard(c: number, k: number): void {
    if (!this.isFocus()) {
      this.tapParked(c);
      return;
    }
    const board = this.board();
    const column = board?.columns[c];
    const index = this.pages[c] * CARDS + k;
    const card = column?.cards[index];
    if (!board || !column || !card) return;
    if (held == null) {
      held = { boardId: board.id, cardId: card.id };
      play('pick', board.pose);
      workspace.notify({ text: `Holding "${panelText(presentationText(card.title))}". Tap a column to drop it.`, error: false });
      this.system.renderAll();
    } else if (held.cardId === card.id) {
      held = null;
      this.system.renderAll();
    } else {
      this.system.drop(board, column.id, index);
    }
  }

  tapColumn(c: number): void {
    if (!this.isFocus()) {
      this.tapParked(c);
      return;
    }
    const board = this.board();
    const column = board?.columns[c];
    if (!board || !column) return;
    if (held != null) {
      this.system.drop(board, column.id, undefined);
    } else if (column.cards.length > CARDS) {
      this.pages[c] = (this.pages[c] + 1) % Math.ceil(column.cards.length / CARDS);
      this.render();
    }
  }

  /** Any other tap on the board (title, padding): on a parked board, bring it within reach. */
  tapBoard(): void {
    if (this.isFocus()) return;
    this.tapParked(null);
  }

  private tapParked(c: number | null): void {
    const board = this.board();
    const column = c == null ? undefined : board?.columns[c];
    if (!board) return;
    if (held != null) this.system.drop(board, (column ?? board.columns[0]).id, undefined);
    else this.tapFocus();
  }

  tapFocus(): void {
    const board = this.board();
    if (board) workspace.dispatch({ op: 'focus_board', board: board.id }, { notice: `"${panelText(presentationText(board.title))}" is within reach.` });
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.pinned.dispose();
  }
}

function bindSlots(document: UIKitDocument, view: BoardView): Slots {
  const get = (id: string) => {
    const element = document.querySelector(`#${id}`) as Element | null;
    if (!element) throw new Error(`board.uikitml has no #${id}`);
    element.name = `${view.id}:${id}`; // addressable from tests and the IWSDK CLI
    return element;
  };
  const slots: Slots = {
    root: get('board'),
    title: get('title'),
    focus: get('focus'),
    columns: Array.from({ length: COLUMNS }, (_, c) => ({
      box: get(`col-${c}`),
      title: get(`col-${c}-title`),
      count: get(`col-${c}-count`),
      more: get(`col-${c}-more`),
      cards: Array.from({ length: CARDS }, (_, k) => ({
        box: get(`card-${c}-${k}`),
        mark: get(`card-${c}-${k}-mark`),
        text: get(`card-${c}-${k}-text`),
        min: get(`card-${c}-${k}-min`),
      })),
    })),
  };
  // One listener on the board root (see PanelHits): cards first, then columns, then the board itself.
  const controls: [string, Element][] = [['focus', slots.focus]];
  slots.columns.forEach((column, c) => column.cards.forEach((card, k) => controls.push([`card-${c}-${k}`, card.box])));
  slots.columns.forEach((column, c) => controls.push([`col-${c}`, column.box]));
  controls.push(['board', slots.root]);
  new PanelHits(slots.root, controls, {
    click: (key) => {
      const [kind, c, k] = key.split('-');
      if (kind === 'card') view.tapCard(Number(c), Number(k));
      else if (kind === 'col') view.tapColumn(Number(c));
      else if (kind === 'focus') view.tapFocus();
      else view.tapBoard();
    },
    hover: (key, hovered) => view.setHover(key, hovered),
  }, view.cleanups);
  return slots;
}

/** The estimate in its own small label, so it never pushes the title onto a third line. */
function minutesLabel(card: Card): string {
  if (!card.minutes) return '';
  return card.minutes >= 60 ? `${Math.floor(card.minutes / 60)}h${card.minutes % 60 ? String(card.minutes % 60).padStart(2, '0') : ''}` : `${card.minutes}m`;
}

/** Shortens at a word boundary so a title never spills past two lines of its card. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return `${space > max / 2 ? cut.slice(0, space) : cut}...`;
}

export class BoardSystem extends createSystem({}) {
  private readonly views = new Map<string, BoardView>();

  init(): void {
    this.cleanupFuncs.push(workspace.subscribe(({ state, source }) => this.sync(state, source)));
    this.cleanupFuncs.push(onSettings(() => this.renderAll())); // high contrast changes the outlines
    this.cleanupFuncs.push(onAccessPreferences(() => this.renderAll()));
    repaintBoards = () => this.renderAll();
    this.cleanupFuncs.push(() => (repaintBoards = null));
    this.sync(workspace.state, 'load');
    this.cleanupFuncs.push(() => {
      for (const view of this.views.values()) view.dispose();
      this.views.clear();
    });
  }

  /** Moves the held card; the selection ends whether or not the engine accepts the move. */
  drop(board: Board, columnId: string, index: number | undefined): void {
    const card = heldCard();
    held = null;
    if (!card) {
      this.renderAll();
      return;
    }
    const column = board.columns.find((c) => c.id === columnId);
    const result = workspace.dispatch(
      { op: 'move_card', card: card.id, board: board.id, column: columnId, index },
      { label: 'move card', notice: `Moved "${panelText(presentationText(card.title))}" to ${panelText(presentationText(column?.title ?? 'column'))}.` },
    );
    if (result.ok) play('drop', board.pose);
    else this.renderAll();
  }

  renderAll(): void {
    for (const view of this.views.values()) view.render();
  }

  /** [source] decides whether a moved board slides (what the person or the AI asked for) or is placed at once. */
  private sync(state: Workspace, source: ChangeSource): void {
    const ids = new Set(state.boards.map((b) => b.id));
    for (const [id, view] of this.views) {
      if (!ids.has(id)) {
        view.dispose();
        this.views.delete(id);
      }
    }
    if (held && !heldCard()) held = null; // the held card was removed (undo, clear done, agent)
    for (const board of state.boards) {
      let view = this.views.get(board.id);
      if (!view) {
        view = new BoardView(this, board.id);
        this.views.set(board.id, view);
      }
      view.pinned.place(board.pose, glidesFor(source));
      // A 6 cm bar 1.45 m away is too small for a shaky ray: parked boards are brought within reach, then moved.
      view.pinned.setHandleVisible(board.id === state.focusBoardId);
      view.render();
    }
  }
}
