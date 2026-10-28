/**
 * Speech to text for voice commands. The microphone is streamed as 16 kHz 16-bit PCM straight to Amazon Transcribe,
 * over a WebSocket URL the command server presigns: the browser never holds AWS credentials, no audio passes through
 * our server, and every listen counts against the server's quotas. One utterance per listen: it ends at a pause after
 * words, on stopListening(), or after the user's configured maximum duration.
 *
 * The browser's own speech recognition is not used: it is missing from some browsers and could not be verified on
 * Meta Quest Browser, while this path needs only a microphone and a WebSocket.
 */
import { activeSession } from '../backend/link.js';
import { audioEvent, decodeMessage, type EventMessage } from './eventstream.js';
import { accessPreferences } from '../accessibility/preferences.js';
import { language } from '../i18n/language.js';
import { AI_PATIENCE_MS, manualModeNotice } from '../backend/resilience.js';

/** `network`: the connection or Transcribe failed or was too slow (AI_PATIENCE_MS), not "nothing was said". */
export type ListenResult = { ok: true; text: string } | { ok: false; error: string; network?: true };

/** What the server answers to a voice session request; `network` is ours: no usable answer. */
type Grant = { ok: boolean; url?: string; error?: string; network?: true };

export interface ListenHandlers {
  /** The words so far, while the user is still speaking. */
  partial?: (text: string) => void;
}

const SAMPLE_RATE = 16_000;
/** With nothing heard at all, give up after this long. */
const NOTHING_MS = 6_000;
/** After the end of the audio, how long Transcribe gets to send its last words. */
const DRAIN_MS = 1_500;

// Runs on the audio thread: float samples in, 100 ms chunks of little-endian 16-bit PCM out.
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.chunk = new Int16Array(1600); this.length = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const s = Math.max(-1, Math.min(1, channel[i]));
        this.chunk[this.length++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.length === this.chunk.length) {
          this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
          this.chunk = new Int16Array(1600);
          this.length = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('spatialdesk-pcm16', Pcm16);
`;

interface TranscriptEvent {
  Transcript?: { Results?: { ResultId?: string; IsPartial?: boolean; Alternatives?: { Transcript?: string }[] }[] };
}

let current: { finish: () => void } | null = null;

export function isListening(): boolean {
  return current != null;
}

/** Ends the current listen now; what was heard so far is still returned. */
export function stopListening(): void {
  current?.finish();
}

export async function listen(handlers: ListenHandlers = {}): Promise<ListenResult> {
  if (current) return { ok: false, error: 'Already listening.' };
  const session = activeSession();
  if (!session) return { ok: false, error: manualModeNotice(), network: true };
  // One deliberate setting snapshot per listen, so changing controls mid-sentence cannot cut someone off.
  const maxMs = accessPreferences.listenMaxMs;
  const pauseMs = accessPreferences.listenPauseMs;
  const finalPauseMs = accessPreferences.listenFinalPauseMs;

  // Until the stream is up, stopping just cancels: nothing has been heard yet.
  let cancelled = false;
  let finish: () => void = () => {
    cancelled = true;
  };
  current = { finish: () => finish() };
  const stopped: ListenResult = { ok: false, error: 'Stopped.' };
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  try {
    // The microphone first: a refusal costs nothing on the server.
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return { ok: false, error: 'The microphone is blocked. Allow it for this site to talk to SpatialDesk.' };
    }
    // The wait for the connection (the server's grant, then Transcribe's socket) starts once the microphone is open.
    const connectBy = performance.now() + AI_PATIENCE_MS;
    const grant: Grant = await fetch('/api/voice/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session': session },
      body: JSON.stringify({ language: language() }), // English unless the link or the person chose another
      signal: AbortSignal.timeout(AI_PATIENCE_MS),
    })
      // A gateway error page (502, 503, 504) is the network's answer, not the server's.
      .then((res) => (res.status >= 500 ? Promise.reject(new Error(`voice ${res.status}`)) : (res.json() as Promise<Grant>)))
      .catch((): Grant => ({ ok: false, network: true }));
    if (cancelled) return stopped;
    if (grant.network) return { ok: false, error: manualModeNotice(), network: true };
    if (!grant.ok || !grant.url) return { ok: false, error: grant.error ?? 'Voice is unavailable right now.' };

    context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const module = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await context.audioWorklet.addModule(module);
    URL.revokeObjectURL(module);
    if (cancelled) return stopped;
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, 'spatialdesk-pcm16');
    source.connect(capture);
    capture.connect(context.destination); // pulls the graph; the node outputs silence

    const ws = new WebSocket(grant.url);
    ws.binaryType = 'arraybuffer';
    let opened = false;
    const waiting: Uint8Array[] = [];
    capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const frame = audioEvent(new Uint8Array(event.data));
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      else if (ws.readyState === WebSocket.CONNECTING) waiting.push(frame);
    };
    ws.onopen = () => {
      opened = true;
      for (const frame of waiting.splice(0)) ws.send(frame);
    };

    return await new Promise<ListenResult>((resolve) => {
      const started = performance.now();
      const finals = new Map<string, string>();
      let partial = '';
      let lastChange = started;
      let failure: string | null = null;
      let network = false;
      let ended = false;
      let drain: ReturnType<typeof setTimeout> | undefined;
      const heard = () => [...finals.values(), partial].join(' ').replace(/\s+/g, ' ').trim();
      /** The connection or Transcribe failed or is too slow: the one calm notice, not "I didn't catch that". */
      const fail = () => {
        failure = manualModeNotice();
        network = true;
      };
      const done = () => {
        clearInterval(clock);
        clearTimeout(drain);
        clearTimeout(connecting);
        ws.onmessage = ws.onclose = ws.onerror = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
        const text = heard();
        resolve(text ? { ok: true, text } : { ok: false, error: failure ?? "I didn't catch that. Press Talk and try again.", ...(network ? { network: true as const } : {}) });
      };
      // Transcribe's socket must be open within AI_PATIENCE_MS of the press, or this is a network problem.
      const connecting = setTimeout(() => {
        if (opened || ended) return;
        fail();
        finish();
      }, Math.max(0, connectBy - performance.now()));
      finish = () => {
        if (ended) return;
        ended = true;
        capture.port.onmessage = null;
        source.disconnect();
        capture.disconnect();
        stream?.getTracks().forEach((track) => track.stop());
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(audioEvent(new Uint8Array(0))); // end of audio: Transcribe sends its last words, then closes
          drain = setTimeout(done, DRAIN_MS);
        } else {
          done();
        }
      };
      const clock = setInterval(() => {
        const now = performance.now();
        const text = heard();
        const pause = partial ? pauseMs : finalPauseMs;
        if (!opened && failure == null && now - started > NOTHING_MS) fail(); // never connected: a network problem, not silence
        if (now - started > maxMs || (text && now - lastChange > pause) || (!text && now - started > NOTHING_MS)) finish();
      }, 100);

      ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        let message: EventMessage;
        try {
          message = decodeMessage(event.data);
        } catch {
          return;
        }
        const body = new TextDecoder().decode(message.payload);
        if (message.headers[':message-type'] === 'exception') {
          console.warn('[voice] Transcribe:', message.headers[':exception-type'], body);
          fail();
          finish();
          return;
        }
        if (message.headers[':event-type'] !== 'TranscriptEvent') return;
        for (const result of (JSON.parse(body) as TranscriptEvent).Transcript?.Results ?? []) {
          const said = result.Alternatives?.[0]?.Transcript?.trim() ?? '';
          if (result.IsPartial) partial = said;
          else {
            finals.set(result.ResultId ?? String(finals.size), said);
            partial = '';
          }
          lastChange = performance.now();
        }
        const text = heard();
        if (text) handlers.partial?.(text);
      };
      ws.onerror = () => fail();
      ws.onclose = () => {
        if (ended) done();
        else {
          if (failure == null) fail(); // Transcribe or the network closed the stream under the person
          finish();
        }
      };
    });
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    void context?.close().catch(() => undefined);
    current = null;
  }
}
