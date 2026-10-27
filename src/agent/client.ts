/**
 * The agent, from the headset's side: one HTTP call to the command server, which asks Amazon Nova for a plan and
 * validates it with the shared engine. Nothing changes here until the user applies the plan.
 */
import { activeSession, forgetActiveSession } from '../backend/link.js';
import type { Op, Pose, Workspace } from '../workspace/model.js';
import type { ConversationTurn } from './conversation.js';
import type { SessionChoice } from './session-input.js';

export type Intent =
  | 'plan_my_day'
  | 'prioritise'
  | 'focus'
  | 'clear_done'
  | 'summarise'
  | 'custom'
  | 'companion'
  | 'session'
  | 'next_block'
  | 'replan'
  | 'regroup'
  | 'wrap_up'
  | 'comfort'
  | 'first_step';

export interface PlanStep {
  op: Op;
  why: string;
}

export interface AgentPlan {
  ok: boolean;
  summary?: string;
  steps: PlanStep[];
  /** The model id, or "built-in" when the server's deterministic planner answered. */
  source?: string;
  latencyMs?: number;
  attempts?: number;
  note?: string;
  error?: string;
}

const OFFLINE: AgentPlan = {
  ok: false,
  steps: [],
  error: 'The AI needs the command server, which is offline. Your workspace still works by hand.',
};

/** [context] says what just happened (a timer ended, a card is running over), for the agent's own suggestions. */
export async function requestPlan(intent: Intent, text: string, workspace: Workspace, viewer: Pose, context?: string, conversation: ConversationTurn[] = [], sessionChoice?: SessionChoice): Promise<AgentPlan> {
  const session = await waitForSession(4000);
  if (!session) return OFFLINE;
  const body = JSON.stringify({ intent, text: text.trim() || undefined, workspace, localTime: localTime(), viewer, context, conversation, sessionChoice });
  try {
    let res = await post(session, body);
    if (res.status === 401) {
      // The server restarted and forgot us: the link reconnects with a fresh session, then we ask once more.
      forgetActiveSession();
      const fresh = await waitForSession(6000, session);
      if (!fresh) return OFFLINE;
      res = await post(fresh, body);
    }
    const plan = (await res.json()) as AgentPlan;
    return { ...plan, steps: plan.steps ?? [] };
  } catch {
    return { ok: false, steps: [], error: 'The command server did not answer. Try again in a moment.' };
  }
}

function post(session: string, body: string): Promise<Response> {
  return fetch('/api/agent/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session': session },
    body,
    signal: AbortSignal.timeout(20_000),
  });
}

async function waitForSession(timeoutMs: number, not?: string): Promise<string | null> {
  const until = performance.now() + timeoutMs;
  for (;;) {
    const id = activeSession();
    if (id && id !== not) return id;
    if (performance.now() > until) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** "Tuesday 2026-10-07 09:10 (UTC+02:00)": the agent plans around the hours left today. */
function localTime(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const day = now.toLocaleDateString('en-GB', { weekday: 'long' });
  return `${day} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} (UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)})`;
}

/** Where a plan came from, in words. Never blurred: a fallback plan says it was not the AI. */
export function sourceLabel(source: string | undefined): string {
  if (source === 'local-accessibility') return 'Your choices';
  if (source === 'saved-work') return 'Local checkpoint';
  if (!source) return '';
  if (source === 'saved-setup') return 'Saved by you';
  if (source === 'session-clock') return 'Session complete';
  if (source === 'built-in') return 'Built-in planner';
  if (source.includes('nova-2-lite')) return 'Amazon Nova 2 Lite';
  if (source.includes('nova')) return 'Amazon Nova';
  return source;
}

/** A step as one short line ("Move "Review PRs" to Doing, top"). Ids from the built-in planner become titles. */
export function describeStep(op: Op, workspace: Workspace): string {
  const card = (ref: string) => {
    for (const b of workspace.boards) for (const c of b.columns) for (const k of c.cards) if (k.id === ref) return k.title;
    return ref;
  };
  const board = (ref: string) => workspace.boards.find((b) => b.id === ref)?.title ?? ref;
  const column = (ref: string) => {
    for (const b of workspace.boards) for (const c of b.columns) if (c.id === ref) return c.title;
    return ref;
  };
  switch (op.op) {
    case 'create_board': return `New board "${op.title}"${op.cards?.length ? ` with ${op.cards.length} cards` : ''}`;
    case 'add_card': return `Add "${op.title}" to ${board(op.board)}`;
    case 'update_card': {
      const changes = [op.priority && `${op.priority} priority`, op.minutes && `${op.minutes} min`, op.title && `rename to "${op.title}"`].filter(Boolean);
      return `"${card(op.card)}": ${changes.join(', ') || 'update'}`;
    }
    case 'move_card': return `Move "${card(op.card)}" to ${column(op.column)}${op.index === 0 ? ', top' : op.index != null ? `, position ${op.index + 1}` : ''}`;
    case 'remove_card': return `Remove "${card(op.card)}"`;
    case 'clear_done': return op.board ? `Clear done on ${board(op.board)}` : 'Clear every Done column';
    case 'focus_board': return `Bring "${board(op.board)}" within reach`;
    case 'start_timer': return `${op.minutes}-minute timer${op.card ? ` on "${card(op.card)}"` : op.label ? ` "${op.label}"` : ''}`;
    case 'arrange_space': return op.layout === 'focus' ? 'Focus mode: other boards step back' : 'Everything back in its place';
    case 'set_comfort': return comfortStep(op);
    default: return op.op.replace(/_/g, ' ');
  }
}

/** One comfort change, as the user will notice it. */
function comfortStep(op: Extract<Op, { op: 'set_comfort' }>): string {
  const parts: string[] = [];
  if (op.reach != null) parts.push(`board ${Math.round(62 * op.reach)} cm away`);
  if (op.scale != null) parts.push(`panels at ${Math.round(op.scale * 100)}%`);
  if (op.side != null) parts.push(op.side === 'both' ? 'both sides' : `everything on your ${op.side}`);
  if (op.turnDeg != null) parts.push(op.turnDeg >= 120 ? 'turn freely' : `no more than a ${Math.round(op.turnDeg)}° turn`);
  if (op.tiltDeg != null) parts.push(op.tiltDeg === 0 ? 'level' : `${Math.abs(Math.round(op.tiltDeg))}° ${op.tiltDeg > 0 ? 'higher' : 'lower'}`);
  return `Comfort: ${parts.join(', ')}`;
}
