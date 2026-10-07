/**
 * Kanban boards in space. Interaction is pick-and-place, which works the same with a poke, a pinch ray, or a mouse:
 * tap a card to pick it up (every column on every board lights up as a drop target), then tap a column to drop it
 * at the end, or tap a card to drop it in that card's place. Tap the held card again to put it back.
 * Panels are only touched when the workspace or the selection changes, never per frame.
 */
import { createSystem, type UIKit, type UIKitDocument } from '@iwsdk/core';
import { PanelHits } from '../ui/panel-hits.js';
import { BOARD_SIZE, panelText, type Board, type Card, type Workspace } from './model.js';
import { PinnedPanel } from './pinned.js';
import { workspace } from './store.js';

const COLUMNS = 4; // slots in public/ui/board.uikitml
const CARDS = 4;
const HANDLE_WIDTH = 0.24;
const CONFIG = `${import.meta.env.BASE_URL}ui/board.uikitml`;

// Off-white on dark greys; every text colour >= 7:1 on its background (ROADMAP heuristic B).
const COLOR = {
  column: '#1d222a',
  columnHover: '#4a5566',
  dropColumn: '#183329',
  dropBorder: '#5ee0a0',
  dropHover: '#b4f7d6',
  card: '#2a313b',
  cardHover: '#9cc3ff',
  heldCard: '#2f5f9e',
  heldBorder: '#9cc3ff',
  focus: '#2f5f9e',
  focusHover: '#9cc3ff',
  mark: { low: '#4c5664', normal: '#7f8b9b', high: '#ff8a7a' },
} as const;

/** Characters that fit two lines of a card, by how many columns share the 72 cm width. */
const CARD_CHARS = [0, 64, 44, 32, 24] as const;

let held: { boardId: string; cardId: string } | null = null;

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
    cards: { box: Element; mark: Element; text: Element }[];
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
    slots.title.setProperties({ text: panelText(board.title) });
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
      slot.title.setProperties({ text: panelText(column.title) });
      slot.count.setProperties({ text: String(column.cards.length) });
      slot.more.setProperties({
        text: column.cards.length > CARDS ? `${first + 1}-${Math.min(first + CARDS, column.cards.length)} of ${column.cards.length}, tap` : '',
      });
      slot.cards.forEach((cardSlot, k) => {
        const card = column.cards[first + k];
        this.paintCard(c, k);
        if (!card) return;
        cardSlot.mark.setProperties({ backgroundColor: COLOR.mark[card.priority] });
        cardSlot.text.setProperties({ text: fit(panelText(cardLabel(card)), maxChars) });
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

  private paintFocus(): void {
    const isFocus = workspace.state.focusBoardId === this.id;
    this.slots?.focus.setProperties({
      display: isFocus ? 'none' : 'flex',
      borderColor: this.hovered.has('focus') ? COLOR.focusHover : COLOR.focus,
    });
  }

  private paintColumn(c: number): void {
    const column = this.board()?.columns[c];
    const box = this.slots?.columns[c].box;
    if (!column || !box) return;
    const dropTarget = held != null && !column.cards.some((card) => card.id === held!.cardId);
    const hovered = this.hovered.has(`col-${c}`);
    box.setProperties({
      display: 'flex',
      backgroundColor: dropTarget ? COLOR.dropColumn : COLOR.column,
      borderColor: dropTarget ? (hovered ? COLOR.dropHover : COLOR.dropBorder) : hovered ? COLOR.columnHover : COLOR.column,
    });
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
    const hovered = this.hovered.has(`card-${c}-${k}`);
    box.setProperties({
      display: 'flex',
      backgroundColor: isHeld ? COLOR.heldCard : COLOR.card,
      borderColor: isHeld ? COLOR.heldBorder : hovered ? COLOR.cardHover : COLOR.card,
    });
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
      workspace.notify({ text: `Holding "${panelText(card.title)}". Tap a column to drop it.`, error: false });
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
    if (board) workspace.dispatch({ op: 'focus_board', board: board.id }, { notice: `"${panelText(board.title)}" is within reach.` });
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

function cardLabel(card: Card): string {
  return card.minutes ? `${card.title} (${card.minutes} min)` : card.title;
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
    this.cleanupFuncs.push(workspace.subscribe(({ state }) => this.sync(state)));
    this.sync(workspace.state);
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
      { label: 'move card', notice: `Moved "${panelText(card.title)}" to ${panelText(column?.title ?? 'column')}.` },
    );
    if (!result.ok) this.renderAll();
  }

  renderAll(): void {
    for (const view of this.views.values()) view.render();
  }

  private sync(state: Workspace): void {
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
      view.pinned.place(board.pose);
      // A 6 cm bar 1.45 m away is too small for a shaky ray: parked boards are brought within reach, then moved.
      view.pinned.setHandleVisible(board.id === state.focusBoardId);
      view.render();
    }
  }
}
