/**
 * The AWS event stream framing that Amazon Transcribe streaming speaks over its WebSocket. Each message is
 *   [total length][headers length][prelude CRC] [headers] [payload] [message CRC]
 * with big-endian 32-bit lengths and CRC-32 (IEEE). Only string headers are written or read: all Transcribe uses.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const STRING = 7;
const PRELUDE = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeMessage(headers: Record<string, string>, payload: Uint8Array): Uint8Array {
  const fields = Object.entries(headers).map(([name, value]) => [encoder.encode(name), encoder.encode(value)] as const);
  const headersLength = fields.reduce((n, [name, value]) => n + 1 + name.length + 1 + 2 + value.length, 0);
  const total = PRELUDE + headersLength + payload.length + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total);
  view.setUint32(4, headersLength);
  view.setUint32(8, crc32(out, 0, 8));
  let at = PRELUDE;
  for (const [name, value] of fields) {
    out[at++] = name.length;
    out.set(name, at);
    at += name.length;
    out[at++] = STRING;
    view.setUint16(at, value.length);
    at += 2;
    out.set(value, at);
    at += value.length;
  }
  out.set(payload, at);
  at += payload.length;
  view.setUint32(at, crc32(out, 0, at));
  return out;
}

export interface EventMessage {
  headers: Record<string, string>;
  payload: Uint8Array;
}

/** One whole message (Transcribe sends one per WebSocket frame); a damaged one throws. */
export function decodeMessage(data: ArrayBuffer): EventMessage {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  const total = view.getUint32(0);
  const headersLength = view.getUint32(4);
  if (total !== bytes.length) throw new Error(`event stream: ${bytes.length} bytes, header says ${total}`);
  if (view.getUint32(8) !== crc32(bytes, 0, 8)) throw new Error('event stream: prelude CRC mismatch');
  if (view.getUint32(total - 4) !== crc32(bytes, 0, total - 4)) throw new Error('event stream: message CRC mismatch');
  const headers: Record<string, string> = {};
  const end = PRELUDE + headersLength;
  let at = PRELUDE;
  while (at < end) {
    const nameLength = bytes[at++];
    const name = decoder.decode(bytes.subarray(at, at + nameLength));
    at += nameLength;
    const type = bytes[at++];
    if (type !== STRING) throw new Error(`event stream: header "${name}" has type ${type}, only strings are read`);
    const valueLength = view.getUint16(at);
    at += 2;
    headers[name] = decoder.decode(bytes.subarray(at, at + valueLength));
    at += valueLength;
  }
  return { headers, payload: bytes.subarray(end, total - 4) };
}

/** A chunk of 16-bit PCM as Transcribe expects it; an empty chunk tells Transcribe the audio has ended. */
export function audioEvent(pcm: Uint8Array): Uint8Array {
  return encodeMessage({ ':content-type': 'application/octet-stream', ':event-type': 'AudioEvent', ':message-type': 'event' }, pcm);
}
