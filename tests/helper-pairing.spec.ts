/**
 * The headset's side of "a family member or carer follows along" without a browser: which cards a helper may see
 * (src/assist/today.ts), and the whole life of an invitation (src/assist/pairing.ts) against a stand-in API: the code,
 * the owner's consent, the board sent and re-sent when it changes, a call for help that opens the guided setup and learns
 * how it ended, stopping, and every way it can end or the network can fail.
 */
import { expect, test } from '@playwright/test';
import { AssistError, type AssistApi, type HelpState, type OwnerView, type SharedTask } from '../src/assist/api.js';
import { INVITE_MS, Pairing, ROOM_MS } from '../src/assist/pairing.js';
import { MAX_SHARED_TASKS, todayBoard, todayTasks } from '../src/assist/today.js';
import type { Board, Workspace } from '../src/workspace/model.js';

const pose = { x: 0, y: 1, z: -1, yaw: 0, pitch: 0 };
const board = (id: string, title: string, columns: [string, string[]][]): Board => ({
  id,
  title,
  pose,
  columns: columns.map(([name, cards], c) => ({ id: `${id}-c${c}`, title: name, cards: cards.map((card, i) => ({ id: `${id}-k${c}-${i}`, title: card, priority: 'normal' })) })),
}) as Board;
const workspace = (boards: Board[], focusBoardId?: string): Workspace => ({ boards, focusBoardId }) as Workspace;

test('the helper sees the Today board: named Today, else the board being worked on, else the first', () => {
  const ideas = board('b2', 'Ideas', [['Someday', ['x']]]);
  const today = board('b3', 'Today', [['To do', ['a']]]);
  const started = board('b1', 'Getting started', [['To do', ['a']]]);
  expect(todayBoard(workspace([started, ideas, today], 'b1'))?.id).toBe('b3');
  expect(todayBoard(workspace([started, ideas], 'b2'))?.id).toBe('b2');
  expect(todayBoard(workspace([started, ideas]))?.id).toBe('b1');
  expect(todayBoard(workspace([board('b9', 'Hoy', [['Hacer', ['a']]]), started]))?.id).toBe('b9');
  expect(todayBoard(workspace([]))).toBeNull();
  expect(todayTasks(workspace([]))).toEqual({ tasks: [], total: 0 });
});

test('only card titles and their column leave: in board order, cleaned, and never more than the server takes', () => {
  const shared = todayTasks(workspace([board('b1', 'Today', [['To do', ['Call mum', '  Buy\tbread\n']], ['Doing', ['Write the report']], ['Done', ['Wake up']]])], 'b1'));
  expect(shared.tasks).toEqual([
    { id: 'b1-k0-0', title: 'Call mum', column: 'To do' },
    { id: 'b1-k0-1', title: 'Buy bread', column: 'To do' },
    { id: 'b1-k1-0', title: 'Write the report', column: 'Doing' },
    { id: 'b1-k2-0', title: 'Wake up', column: 'Done' },
  ]);
  for (const task of shared.tasks) expect(Object.keys(task).sort()).toEqual(['column', 'id', 'title']); // no notes, minutes, priority
  // A title longer than the server accepts is cut, and a card with nothing in it is not sent.
  const long = todayTasks(workspace([board('b1', 'Today', [['To do', ['x'.repeat(400), '   ', '\u0007']]])]));
  expect(long.tasks.map((task) => task.title.length)).toEqual([160]);

  // More than twelve: what is still to do first, the Done column fills what is left, and the order of the board stays.
  const crowded = todayTasks(workspace([board('b1', 'Today', [['To do', Array.from({ length: 10 }, (_, i) => `todo ${i}`)], ['Doing', ['doing 0', 'doing 1', 'doing 2']], ['Done', ['done 0', 'done 1', 'done 2']]])]));
  expect(crowded.total).toBe(16);
  expect(crowded.tasks).toHaveLength(MAX_SHARED_TASKS);
  expect(crowded.tasks.filter((task) => task.column === 'Done')).toHaveLength(0);
  expect(crowded.tasks.map((task) => task.title).slice(0, 3)).toEqual(['todo 0', 'todo 1', 'todo 2']);
  expect(new Set(crowded.tasks.map((task) => task.id)).size).toBe(MAX_SHARED_TASKS);
});

/** A stand-in for the helper service, driven by the test: who is waiting, who is approved, what was sent. */
function stand() {
  const state = {
    created: 0,
    revoked: 0,
    approvals: [] as { requestId: string; allowConfiguration: boolean; tasks: SharedTask[] }[],
    resolutions: [] as { helpId: string; state: string }[],
    requests: [] as { requestId: string; state: 'pending' | 'approved'; requestedAt: number }[],
    help: [] as { helpId: string; requestId: string; state: HelpState; createdAt: number }[],
    fail: null as null | AssistError,
    oldServer: false,
    session: 'owner-session' as string | null,
  };
  const api: AssistApi = {
    createPair: async () => {
      if (state.fail) throw state.fail;
      state.created++;
      return { pairId: `pair-${state.created}`, code: 'K7M29PQX', expiresAt: 0, roomExpiresAt: 0 };
    },
    owner: async (_session, pairId): Promise<OwnerView> => {
      if (state.fail) throw state.fail;
      return { pairId, expiresAt: 0, inviteExpiresAt: 0, requests: state.requests, ...(state.oldServer ? {} : { help: state.help }) };
    },
    approve: async (_session, _pair, requestId, allowConfiguration, tasks) => {
      if (state.fail) throw state.fail;
      state.approvals.push({ requestId, allowConfiguration, tasks });
      const request = state.requests.find((r) => r.requestId === requestId);
      if (request) request.state = 'approved';
    },
    resolveHelp: async (_session, _pair, helpId, helpState) => {
      state.resolutions.push({ helpId, state: helpState });
      const help = state.help.find((h) => h.helpId === helpId);
      if (help) help.state = helpState;
    },
    revoke: async () => {
      state.revoked++;
    },
    join: async () => {
      throw new Error('the headset never joins');
    },
    helper: async () => {
      throw new Error('the headset is never a helper');
    },
    requestHelp: async () => {
      throw new Error('the headset never asks for help');
    },
  };
  return { state, api };
}

function pairing(options: { tasks?: () => SharedTask[]; openSetup?: () => boolean } = {}) {
  const { state, api } = stand();
  let now = 0;
  const setup = { closed: [] as ((skipped: boolean) => void)[], opened: 0 };
  const board = { tasks: [{ id: 'k1', title: 'Call mum', column: 'To do' }] as SharedTask[] };
  const p = new Pairing({
    api,
    session: () => state.session,
    tasks: options.tasks ?? (() => board.tasks),
    openSetup: options.openSetup ?? (() => (setup.opened++, true)),
    onSetupClosed: (listener) => {
      setup.closed.push(listener);
      return () => undefined;
    },
    now: () => now,
    pollMs: 10_000_000, // the tests drive every round themselves
  });
  return { p, state, setup, board, advance: (ms: number) => (now += ms), dispose: () => p.dispose() };
}

test('an invitation: a code to type, nothing shared until the owner allows, then the board and only the board', async () => {
  const t = pairing();
  await t.p.invite();
  expect(t.p.view).toMatchObject({ stage: 'inviting', code: 'K7M2 9PQX', pending: 0, helpers: 0 });
  expect(t.state.approvals).toEqual([]);

  t.state.requests.push({ requestId: 'r1', state: 'pending', requestedAt: 1 });
  await t.p.poll();
  expect(t.p.view).toMatchObject({ stage: 'asking', pending: 1 });
  expect(t.state.approvals, 'a request alone shares nothing').toEqual([]);

  await t.p.allow();
  expect(t.state.approvals).toEqual([{ requestId: 'r1', allowConfiguration: false, tasks: [{ id: 'k1', title: 'Call mum', column: 'To do' }] }]);
  expect(t.p.view).toMatchObject({ stage: 'sharing', helpers: 1, shared: 1 });

  // The board changes: the next round sends it again. Unchanged, it is not sent again.
  await t.p.poll();
  expect(t.state.approvals).toHaveLength(1);
  t.board.tasks = [...t.board.tasks, { id: 'k2', title: 'Buy bread', column: 'Doing' }];
  await t.p.poll();
  expect(t.state.approvals).toHaveLength(2);
  expect(t.state.approvals[1].tasks.map((task) => task.title)).toEqual(['Call mum', 'Buy bread']);
  expect(t.p.view.shared).toBe(2);
  expect(t.state.approvals.every((a) => a.allowConfiguration === false), 'a helper may look and call, never configure').toBe(true);
  t.dispose();
});

test('a call for help opens the guided setup, and the helper hears how it went', async () => {
  const t = pairing();
  await t.p.invite();
  t.state.requests.push({ requestId: 'r1', state: 'approved', requestedAt: 1 });
  t.state.help.push({ helpId: 'h1', requestId: 'r1', state: 'pending', createdAt: 1 });
  await t.p.poll();
  expect(t.setup.opened).toBe(1);
  expect(t.p.view).toMatchObject({ helpCalls: 1, lastHelp: 'shown' });
  expect(t.state.resolutions).toEqual([{ helpId: 'h1', state: 'shown' }]);
  await t.p.poll();
  expect(t.setup.opened, 'the same call opens the setup once').toBe(1);

  t.setup.closed.forEach((listener) => listener(false)); // the owner finished the setup
  await Promise.resolve();
  await Promise.resolve();
  expect(t.p.view.lastHelp).toBe('done');
  expect(t.state.resolutions.at(-1)).toEqual({ helpId: 'h1', state: 'done' });

  // A second call, skipped by the owner.
  t.state.help.push({ helpId: 'h2', requestId: 'r1', state: 'pending', createdAt: 2 });
  await t.p.poll();
  t.setup.closed.forEach((listener) => listener(true));
  await Promise.resolve();
  await Promise.resolve();
  expect(t.state.resolutions.at(-1)).toEqual({ helpId: 'h2', state: 'dismissed' });
  expect(t.p.view.lastHelp).toBe('dismissed');

  // Nothing could open the setup: the helper is told at once.
  const none = pairing({ openSetup: () => false });
  await none.p.invite();
  none.state.requests.push({ requestId: 'r1', state: 'approved', requestedAt: 1 });
  none.state.help.push({ helpId: 'h9', requestId: 'r1', state: 'pending', createdAt: 1 });
  await none.p.poll();
  expect(none.state.resolutions).toEqual([{ helpId: 'h9', state: 'dismissed' }]);
  t.dispose();
  none.dispose();
});

test('stopping withdraws the code and the view; the code, the room and the connection each end it in their own way', async () => {
  const t = pairing();
  await t.p.invite();
  t.state.requests.push({ requestId: 'r1', state: 'approved', requestedAt: 1 });
  await t.p.poll();
  await t.p.stop();
  expect(t.state.revoked).toBe(1);
  expect(t.p.view).toMatchObject({ stage: 'ended', reason: 'stopped', code: '', helpers: 0 });

  // A new code withdraws the old one first.
  await t.p.invite();
  await t.p.invite();
  expect(t.state.created).toBe(3);

  // Nobody used the code in two minutes: it ends and is withdrawn.
  const quiet = pairing();
  await quiet.p.invite();
  quiet.advance(INVITE_MS + 1);
  await quiet.p.poll();
  expect(quiet.p.view).toMatchObject({ stage: 'ended', reason: 'invite' });
  expect(quiet.state.revoked).toBe(1);

  // A helper is watching: the code running out changes nothing, the room does (the server answers "gone").
  const watched = pairing();
  await watched.p.invite();
  watched.state.requests.push({ requestId: 'r1', state: 'approved', requestedAt: 1 });
  watched.advance(INVITE_MS + 1);
  await watched.p.poll();
  expect(watched.p.view.stage).toBe('sharing');
  watched.advance(ROOM_MS);
  watched.state.fail = new AssistError(404, 'pair_unavailable', 'gone');
  await watched.p.poll();
  expect(watched.p.view).toMatchObject({ stage: 'ended', reason: 'time' });

  // The owner's own session ran out; and no session at all.
  const expired = pairing();
  await expired.p.invite();
  expired.state.fail = new AssistError(401, 'session_expired', 'expired');
  await expired.p.poll();
  expect(expired.p.view).toMatchObject({ stage: 'ended', reason: 'offline' });
  const offline = pairing();
  offline.state.session = null;
  await offline.p.invite();
  expect(offline.p.view).toMatchObject({ stage: 'ended', reason: 'offline' });
  [t, quiet, watched, expired, offline].forEach((x) => x.dispose());
});

test('a network that fails does not end it: it says offline and carries on when the network is back', async () => {
  const t = pairing();
  await t.p.invite();
  t.state.requests.push({ requestId: 'r1', state: 'approved', requestedAt: 1 });
  await t.p.poll();
  t.state.fail = new AssistError(0, 'network', 'no answer');
  await t.p.poll();
  expect(t.p.view).toMatchObject({ stage: 'sharing', online: false });
  t.state.fail = null;
  await t.p.poll();
  expect(t.p.view).toMatchObject({ stage: 'sharing', online: true });

  const refused = pairing();
  refused.state.fail = new AssistError(0, 'network', 'no answer');
  await refused.p.invite();
  expect(refused.p.view).toMatchObject({ stage: 'ended', reason: 'network' });
  t.dispose();
  refused.dispose();
});

test('a server from before the calls for help (no "help" in its answer) still shares the board and does not end the session', async () => {
  const t = pairing();
  t.state.oldServer = true;
  await t.p.invite();
  t.state.requests.push({ requestId: 'r1', state: 'approved', requestedAt: 1 });
  await t.p.poll();
  expect(t.p.view).toMatchObject({ stage: 'sharing', helpers: 1, shared: 1, online: true });
  expect(t.state.approvals).toHaveLength(1);
  t.dispose();
});
