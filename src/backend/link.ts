/**
 * Connection to the SpatialDesk command server. Protocol and clock sync are the Kotlin `:shared` module
 * compiled to JS (vendor/spatialdesk-shared): the exact code the server runs.
 *
 * Offline-first (ScreenDesk lesson): the workspace never waits for the network. This link only reports
 * status; reconnects use jittered exponential backoff and a lost/unknown session simply asks for a new one.
 * Nothing here runs per frame.
 */
import { ClockSync, Protocol, ServerMessage } from 'spatialdesk-shared';

const protocol = Protocol.getInstance(); // Kotlin `object` exported as a singleton

export type LinkState =
  | { kind: 'connecting' }
  | { kind: 'online'; sessionId: string; rttMs: number; clockSynced: boolean }
  | { kind: 'offline'; retryInMs: number; reason: string };

const CLOSE_UNKNOWN_SESSION = 4404;
/** How long the link waits for an HTTP answer before it counts as no answer. */
const ASK_MS = 5_000;

let active: BackendLink | null = null;

/** The live session id, for HTTP calls that need one (the agent); null while connecting or offline. */
export function activeSession(): string | null {
  return active?.session ?? null;
}

/** The server no longer knows our session (it restarted): drop it, and the link reconnects with a fresh one. */
export function forgetActiveSession(): void {
  active?.forgetSession();
}

/** Someone is waiting for the server right now: the link does not sit out its backoff. */
export function wakeLink(): void {
  active?.wake();
}

/** The live session id, other than [not] when that one has just been refused; null if none comes in time. */
export async function waitForSession(timeoutMs: number, not?: string): Promise<string | null> {
  const until = performance.now() + timeoutMs;
  for (;;) {
    const id = activeSession();
    if (id && id !== not) return id;
    if (performance.now() > until) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export class BackendLink {
  readonly clock = new ClockSync(8);
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private attempt = 0;
  private pingTimer = 0;
  private pingsSent = 0;
  /** Set only while waiting out the backoff. */
  private retryTimer = 0;
  private stopped = false;

  constructor(private readonly onState: (state: LinkState) => void, private readonly base = location.origin) {}

  start(): void {
    active = this;
    void this.connect();
  }

  get session(): string | null {
    return this.sessionId;
  }

  forgetSession(): void {
    this.sessionId = null;
    this.attempt = 0;
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) this.socket.close(1000); // its close retries
    else this.wake();
  }

  wake(): void {
    if (this.retryTimer === 0) return; // connected, or already trying
    window.clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    void this.connect();
  }

  stop(): void {
    if (active === this) active = null;
    this.stopped = true;
    window.clearTimeout(this.pingTimer);
    window.clearTimeout(this.retryTimer);
    this.socket?.close(1000);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.onState({ kind: 'connecting' });
    try {
      if (this.sessionId !== null && !(await this.stillKnown(this.sessionId))) this.sessionId = null;
      if (this.sessionId === null) {
        const res = await fetch(`${this.base}/api/sessions`, { method: 'POST', signal: AbortSignal.timeout(ASK_MS) });
        if (!res.ok) throw new Error(`session ${res.status}`);
        this.sessionId = ((await res.json()) as { sessionId: string }).sessionId;
      }
      const url = new URL(`/ws?session=${encodeURIComponent(this.sessionId)}`, this.base);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onmessage = (event) => this.onMessage(String(event.data));
      socket.onclose = (event) => {
        window.clearTimeout(this.pingTimer);
        if (event.code === CLOSE_UNKNOWN_SESSION || event.code === 1008) this.sessionId = null;
        this.retry(`socket closed (${event.code})`);
      };
    } catch (error) {
      this.retry(error instanceof Error ? error.message : 'network error');
    }
  }

  /**
   * A refused handshake reaches the browser as a plain close, the same as a lost network, so before reconnecting the server
   * is asked over HTTP: the socket's path answers 401 to an id it does not know (a restart forgets them all) and 400 to one
   * it knows, as this is no upgrade. Anything else says nothing about the id, and it is kept.
   */
  private async stillKnown(id: string): Promise<boolean> {
    const res = await fetch(`${this.base}/ws?session=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(ASK_MS) });
    return res.status !== 401;
  }

  private onMessage(json: string): void {
    const message = protocol.decodeServer(json);
    if (message instanceof ServerMessage.Hello) {
      this.attempt = 0;
      this.pingsSent = 0;
      this.ping();
      this.publishOnline();
    } else if (message instanceof ServerMessage.Pong) {
      // clientTimeMs 0 is the server's keep-alive, not an answer to one of our pings.
      if (message.clientTimeMs > 0) this.clock.onPong(message.clientTimeMs, message.serverTimeMs, performance.timeOrigin + performance.now());
      this.publishOnline();
    }
  }

  /** Fast pings until the clock is well sampled, then a slow cadence that also tracks drift. */
  private ping(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(protocol.ping(performance.timeOrigin + performance.now()));
    this.pingsSent++;
    this.pingTimer = window.setTimeout(() => this.ping(), this.pingsSent < 6 ? 1_000 : 20_000);
  }

  private publishOnline(): void {
    if (this.sessionId === null) return;
    this.onState({ kind: 'online', sessionId: this.sessionId, rttMs: this.clock.rttMs, clockSynced: this.clock.synced });
  }

  private retry(reason: string): void {
    if (this.stopped) return;
    const ceiling = Math.min(30_000, 1_000 * 2 ** Math.min(this.attempt, 5));
    const delay = 500 + Math.random() * (ceiling - 500); // full jitter: every headset does not retry at once
    this.attempt++;
    this.onState({ kind: 'offline', retryInMs: delay, reason });
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      void this.connect();
    }, delay);
  }
}
