/**
 * The workspace as JSON, typed for TypeScript. The source of truth is the Kotlin `:shared` module (Workspace.kt):
 * these mirror its serialised shape, and the engine itself runs as compiled Kotlin (vendor/spatialdesk-shared).
 */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export type Priority = 'low' | 'normal' | 'high';

export interface Card {
  id: string;
  title: string;
  minutes?: number;
  priority: Priority;
}

export interface Column {
  id: string;
  title: string;
  cards: Card[];
}

export interface Board {
  id: string;
  title: string;
  columns: Column[];
  pose: Pose;
}

export type TimerState = 'running' | 'paused' | 'done';

export interface Timer {
  id: string;
  label: string;
  durationMs: number;
  state: TimerState;
  endsAtMs?: number;
  remainingMs: number;
  cardId?: string;
  pose: Pose;
}

export interface Workspace {
  schema: number;
  revision: number;
  nextId: number;
  anchor: Pose;
  focusBoardId?: string;
  boards: Board[];
  timers: Timer[];
}

export interface NewCard {
  title: string;
  column?: string;
  minutes?: number;
  priority?: Priority;
}

/** The operations the engine understands: the same vocabulary for hands and for the AI agent. */
export type Op =
  | { op: 'create_board'; title: string; columns?: string[]; cards?: NewCard[]; focus?: boolean }
  | { op: 'add_card'; board: string; title: string; column?: string; minutes?: number; priority?: Priority; index?: number }
  | { op: 'update_card'; card: string; board?: string; title?: string; minutes?: number; priority?: Priority }
  | { op: 'move_card'; card: string; column: string; board?: string; index?: number }
  | { op: 'remove_card'; card: string; board?: string }
  | { op: 'clear_done'; board?: string }
  | { op: 'delete_board'; board: string }
  | { op: 'focus_board'; board: string }
  | { op: 'start_timer'; minutes: number; label?: string; card?: string }
  | { op: 'pause_timer'; timer: string }
  | { op: 'resume_timer'; timer: string }
  | { op: 'add_time'; timer: string; minutes: number }
  | { op: 'finish_timer'; timer: string }
  | { op: 'dismiss_timer'; timer: string }
  | { op: 'arrange_space'; layout?: 'desk' | 'focus' }
  | { op: 'set_pose'; id: string; pose: Pose };

export interface ApplyResult {
  ok: boolean;
  state?: Workspace;
  created: string[];
  error?: string;
  opIndex?: number;
}

/** World size of the panels in metres: must match Layout.kt (BOARD_WIDTH, ...), which places them. */
export const BOARD_SIZE = { width: 0.72, height: 0.5 } as const;
export const TIMER_SIZE = { width: 0.24, height: 0.16 } as const;

/**
 * The bundled MSDF font (Inter) has ASCII only: accents are folded ("Revisión" -> "Revision"), typographic
 * punctuation is mapped to ASCII, and anything else is dropped rather than drawn as an empty box.
 */
export function panelText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, '-')
    .replace(/…/gu, '...')
    .replace(/[^\x20-\x7e]/gu, '');
}
