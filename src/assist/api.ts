/**
 * The helper API from the browser's side (server/app .../assist/AssistApi.kt): a person outside the headset, who the
 * owner has invited and approved, sees the owner's Today board and can call for help recalibrating. Plain fetch, no
 * framework: the companion page (companion.html) and the headset both use this file, so it must stay tiny and must not
 * import anything heavy.
 */

export interface SharedTask {
  id: string;
  title: string;
  column: string;
}

export type HelpState = 'pending' | 'shown' | 'done' | 'dismissed';

export interface HelpView {
  helpId: string;
  requestId: string;
  state: HelpState;
  createdAt: number;
}

export interface AccessRequestView {
  requestId: string;
  state: 'pending' | 'approved';
  requestedAt: number;
}

export interface OwnerView {
  pairId: string;
  expiresAt: number;
  inviteExpiresAt: number;
  requests: AccessRequestView[];
  /** Absent from a server that predates the calls for help. */
  help?: HelpView[];
}

export interface HelperView {
  pairId: string;
  requestId: string;
  approved: boolean;
  state: 'pending' | 'approved';
  expiresAt: number;
  tasks?: SharedTask[] | null;
  help?: HelpView | null;
}

export interface PairCreated {
  pairId: string;
  code: string;
  expiresAt: number;
  roomExpiresAt: number;
}

export interface JoinResult {
  requestId: string;
  pairId: string;
  state: 'pending' | 'approved';
  expiresAt: number;
}

/** [status] 0 means the network: no answer, or one too slow. Otherwise the server's own code (see AssistRegistry). */
export class AssistError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** How long one call may take before it counts as a network failure. */
export const CALL_TIMEOUT_MS = 7_000;

/** Every call the two sides make, in one object, so tests can stand a stand-in server in its place. */
export interface AssistApi {
  createPair(session: string): Promise<PairCreated>;
  join(session: string, code: string): Promise<JoinResult>;
  owner(session: string, pairId: string): Promise<OwnerView>;
  approve(session: string, pairId: string, requestId: string, allowConfiguration: boolean, tasks: SharedTask[]): Promise<void>;
  helper(session: string, pairId: string): Promise<HelperView>;
  requestHelp(session: string, pairId: string): Promise<{ helpId: string; state: HelpState }>;
  resolveHelp(session: string, pairId: string, helpId: string, state: Exclude<HelpState, 'pending'>): Promise<void>;
  revoke(session: string, pairId: string): Promise<void>;
}

async function call<T>(session: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/assist${path}`, {
      method,
      headers: { 'X-Session': session, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    throw new AssistError(0, 'network', 'The network did not answer.');
  }
  // A gateway page is not JSON: that is null here, and the network's answer below.
  const json = (await res.json().catch(() => null)) as { ok?: boolean; code?: string; error?: string } | null;
  if (!res.ok || json?.ok === false) {
    // A 5xx without the server's own JSON is the network's answer (a gateway), not the helper service's.
    throw new AssistError(json?.code ? res.status : 0, json?.code ?? 'network', json?.error ?? 'The server did not answer.');
  }
  return json as T;
}

/** A session for this browser: the same kind the headset gets, and the only credential the helper API accepts. */
export async function createSession(): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/sessions', { method: 'POST', signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch {
    throw new AssistError(0, 'network', 'The network did not answer.');
  }
  if (!res.ok) throw new AssistError(res.status >= 500 ? 0 : res.status, res.status >= 500 ? 'network' : 'session', 'The server would not start a session.');
  try {
    return ((await res.json()) as { sessionId: string }).sessionId;
  } catch {
    throw new AssistError(0, 'network', 'The server did not answer.');
  }
}

export const assistApi: AssistApi = {
  createPair: (session) => call<PairCreated>(session, 'POST', '/pairs'),
  join: (session, code) => call<JoinResult>(session, 'POST', '/join', { code }),
  owner: (session, pairId) => call<OwnerView>(session, 'GET', `/pairs/${encodeURIComponent(pairId)}/owner`),
  approve: async (session, pairId, requestId, allowConfiguration, tasks) => {
    await call(session, 'POST', `/pairs/${encodeURIComponent(pairId)}/approve`, { requestId, allowConfiguration, tasks });
  },
  helper: (session, pairId) => call<HelperView>(session, 'GET', `/pairs/${encodeURIComponent(pairId)}/helper`),
  requestHelp: (session, pairId) => call<{ helpId: string; state: HelpState }>(session, 'POST', `/pairs/${encodeURIComponent(pairId)}/help`),
  resolveHelp: async (session, pairId, helpId, state) => {
    await call(session, 'POST', `/pairs/${encodeURIComponent(pairId)}/help/resolve`, { helpId, state });
  },
  revoke: async (session, pairId) => {
    await call(session, 'DELETE', `/pairs/${encodeURIComponent(pairId)}`);
  },
};
