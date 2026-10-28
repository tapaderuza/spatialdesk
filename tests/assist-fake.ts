/**
 * A stand-in for the helper service (server/app .../assist/AssistRegistry.kt) for browser tests: the same routes, the same
 * JSON, the same refusals for what the two sides use (sessions, an invitation that expires, nothing shared before the
 * owner approves, one open call for help at a time and a cooldown). Installed on a browser context, so a headset page and a
 * companion page opened in it talk to each other. The real server is checked in server/app (AssistTest) and by
 * tests/assist-real.spec.ts against a locally running jar.
 */
import type { BrowserContext, Route } from '@playwright/test';

interface Request { id: string; helper: string; approved: boolean; tasks: { id: string; title: string; column: string }[] }
interface Help { id: string; requestId: string; state: string; createdAt: number }
interface Room { id: string; owner: string; code: string; inviteEnds: number; ends: number; requests: Request[]; help: Help[] }

export class FakeAssist {
  clock = Date.now();
  readonly sessions = new Set<string>();
  readonly rooms = new Map<string, Room>();
  /** Every call the pages made, "METHOD /path", so a test can say what was (not) asked. */
  readonly calls: string[] = [];
  /** The body of every approval the owner sent: what actually left the headset. */
  readonly approvals: Record<string, any>[] = [];
  private nextId = 1;

  async install(context: BrowserContext): Promise<void> {
    await context.route('**/api/sessions', (route) => {
      const id = `fake-session-${String(this.nextId++).padStart(10, '0')}`;
      this.sessions.add(id);
      return route.fulfill({ json: { sessionId: id, protocol: 1 } });
    });
    await context.route('**/api/assist/**', (route) => this.handle(route));
  }

  /**
   * A room whose owner is not a page, to test the companion page alone: its code, a way to allow whoever joined with the
   * given cards, to change them, to answer a call for help, and to end it.
   */
  room(tasks: { id: string; title: string; column: string }[]) {
    const owner = `fake-owner-${this.nextId++}`;
    this.sessions.add(owner);
    const code = 'ABCD2345';
    const room: Room = { id: this.id(), owner, code, inviteEnds: this.clock + 120_000, ends: this.clock + 900_000, requests: [], help: [] };
    this.rooms.set(room.id, room);
    return {
      code,
      room,
      allow: () => room.requests.forEach((r) => Object.assign(r, { approved: true, tasks })),
      show: (next: { id: string; title: string; column: string }[]) => room.requests.forEach((r) => (r.tasks = next)),
      answer: (state: string) => room.help.forEach((h) => (h.state = state)),
      end: () => this.rooms.delete(room.id),
    };
  }

  /** A call for help as the server's HelpView shows it (helpId, not id). */
  private helpView(h: Help) {
    return { helpId: h.id, requestId: h.requestId, state: h.state, createdAt: h.createdAt };
  }

  private id(): string {
    return `id${(this.nextId++).toString(36)}x${Math.random().toString(36).slice(2, 10)}`;
  }

  private fail(route: Route, status: number, code: string, error: string) {
    return route.fulfill({ status, json: { ok: false, code, error } });
  }

  private async handle(route: Route) {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/assist', '');
    const method = request.method();
    this.calls.push(`${method} ${path}`);
    const session = request.headers()['x-session'];
    if (!session || !this.sessions.has(session)) return this.fail(route, 401, 'session_expired', 'Your session has expired.');
    const body = request.postData() ? (JSON.parse(request.postData()!) as Record<string, any>) : {};
    const now = this.clock;
    for (const [id, room] of this.rooms) if (now >= room.ends) this.rooms.delete(id);

    if (method === 'POST' && path === '/pairs') {
      const code = Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      const room: Room = { id: this.id(), owner: session, code, inviteEnds: now + 120_000, ends: now + 900_000, requests: [], help: [] };
      this.rooms.set(room.id, room);
      return route.fulfill({ json: { ok: true, pairId: room.id, code, expiresAt: room.inviteEnds, roomExpiresAt: room.ends } });
    }
    if (method === 'POST' && path === '/join') {
      const code = String(body.code ?? '').toUpperCase().replace(/[ -]/g, '');
      const room = [...this.rooms.values()].find((candidate) => candidate.code === code && now < candidate.inviteEnds);
      if (!room) return this.fail(route, 404, 'invitation_unavailable', 'The code is not available.');
      if (room.owner === session) return this.fail(route, 409, 'owner_cannot_join', 'You own this invitation.');
      const existing = room.requests.find((r) => r.helper === session);
      const joined = existing ?? { id: this.id(), helper: session, approved: false, tasks: [] };
      if (!existing) room.requests.push(joined);
      return route.fulfill({ json: { ok: true, requestId: joined.id, pairId: room.id, state: joined.approved ? 'approved' : 'pending', expiresAt: room.ends } });
    }
    const match = /^\/pairs\/([^/]+)(\/.*)?$/.exec(path);
    const room = match ? this.rooms.get(decodeURIComponent(match[1])) : undefined;
    if (!match || !room) return this.fail(route, 404, 'pair_unavailable', 'The link is no longer available.');
    const rest = match[2] ?? '';
    const helperRequest = room.requests.find((r) => r.helper === session);

    if (method === 'DELETE' && rest === '') {
      if (room.owner !== session) return this.fail(route, 403, 'owner_required', 'Only the owner.');
      this.rooms.delete(room.id);
      return route.fulfill({ json: { ok: true, pairId: room.id, state: 'revoked' } });
    }
    if (method === 'GET' && rest === '/owner') {
      if (room.owner !== session) return this.fail(route, 403, 'owner_required', 'Only the owner.');
      return route.fulfill({
        json: {
          ok: true, pairId: room.id, expiresAt: room.ends, inviteExpiresAt: room.inviteEnds, proposals: [],
          requests: room.requests.map((r) => ({ requestId: r.id, state: r.approved ? 'approved' : 'pending', requestedAt: now, allowConfiguration: false, taskIds: r.tasks.map((t) => t.id) })),
          help: room.help.map((h) => this.helpView(h)),
        },
      });
    }
    if (method === 'POST' && rest === '/approve') {
      if (room.owner !== session) return this.fail(route, 403, 'owner_required', 'Only the owner.');
      const target = room.requests.find((r) => r.id === body.requestId);
      if (!target) return this.fail(route, 404, 'request_unavailable', 'That request is gone.');
      if (!Array.isArray(body.tasks) || body.tasks.length > 12) return this.fail(route, 400, 'invalid_tasks', 'Up to twelve tasks.');
      this.approvals.push(body);
      target.approved = true;
      target.tasks = body.tasks;
      return route.fulfill({ json: { ok: true, pairId: room.id, requestId: target.id, state: 'approved' } });
    }
    if (!helperRequest && rest !== '/help/resolve') return this.fail(route, 403, 'helper_not_joined', 'Join first.');
    if (method === 'GET' && rest === '/helper') {
      const r = helperRequest!;
      const latest = [...room.help].reverse().find((h) => h.requestId === r.id);
      return route.fulfill({ json: { ok: true, pairId: room.id, requestId: r.id, approved: r.approved, state: r.approved ? 'approved' : 'pending', expiresAt: room.ends, allowConfiguration: false, ...(r.approved ? { tasks: r.tasks, help: latest ? this.helpView(latest) : null } : {}) } });
    }
    if (method === 'POST' && rest === '/help') {
      const r = helperRequest!;
      if (!r.approved) return this.fail(route, 403, 'not_approved', 'Not approved yet.');
      const open = room.help.find((h) => h.requestId === r.id && h.state === 'pending');
      if (open) return route.fulfill({ json: { ok: true, helpId: open.id, state: open.state } });
      const last = [...room.help].reverse().find((h) => h.requestId === r.id);
      if (last && now - last.createdAt < 5_000) return this.fail(route, 429, 'help_cooldown', 'Wait a few seconds.');
      const help: Help = { id: this.id(), requestId: r.id, state: 'pending', createdAt: now };
      room.help.push(help);
      return route.fulfill({ json: { ok: true, helpId: help.id, state: 'pending' } });
    }
    if (method === 'POST' && rest === '/help/resolve') {
      if (room.owner !== session) return this.fail(route, 403, 'owner_required', 'Only the owner.');
      const help = room.help.find((h) => h.id === body.helpId);
      if (!help) return this.fail(route, 404, 'help_unavailable', 'That call is gone.');
      if (!['shown', 'done', 'dismissed'].includes(body.state)) return this.fail(route, 400, 'invalid_state', 'Choose shown, done or dismissed.');
      help.state = body.state;
      return route.fulfill({ json: { ok: true, helpId: help.id, state: help.state } });
    }
    return this.fail(route, 404, 'pair_unavailable', 'Unknown route.');
  }
}
