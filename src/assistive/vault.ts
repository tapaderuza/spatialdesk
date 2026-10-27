/** Opt-in private storage. A locked vault exposes only its encrypted envelope. */
export type VaultStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type VaultErrorCode = 'locked' | 'passphrase' | 'authentication' | 'corrupt' | 'storage' | 'capacity' | 'invalid' | 'conflict' | 'unavailable';

export interface VaultError {
  code: VaultErrorCode;
  message: string;
}

export type VaultValue = null | boolean | number | string | VaultValue[] | { [key: string]: VaultValue };

export const VAULT_LIMITS = Object.freeze({ records: 64, recordBytes: 8192, plaintextBytes: 65536, envelopeCharacters: 100000, iterations: 600000 });
export const PRIVATE_VAULT_KEY = 'spatialdesk.private-vault.v1';

interface Envelope {
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string; data: string };
}

interface Payload { version: 1; records: Record<string, VaultValue> }
const encoder = new TextEncoder();
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const messages: Record<VaultErrorCode, string> = {
  locked: 'El almacén está bloqueado. Desbloquéalo para acceder a los datos.',
  passphrase: 'Elige una frase de 12 a 256 caracteres. No se guarda y no podemos recuperarla.',
  authentication: 'No se pudo desbloquear: la frase no coincide o los datos cifrados han sido alterados.',
  corrupt: 'El archivo cifrado tiene un formato dañado o no compatible. No se ha reemplazado.',
  storage: 'El navegador no permite acceder o guardar el almacén. Los cambios no se han guardado.',
  capacity: 'El almacén supera su límite de tamaño o de registros. No se han guardado los cambios.',
  invalid: 'El nombre o el contenido del registro no es válido.',
  conflict: 'El almacén cambió o hay una operación pendiente. Revisa su estado antes de continuar.',
  unavailable: 'Este navegador no ofrece el cifrado necesario. Usa un contexto seguro compatible.',
};

function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every(key => expected.includes(key));
}

function keyValid(key: string): boolean {
  return typeof key === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,79}$/.test(key) && !forbidden.has(key);
}

function jsonValue(value: unknown, seen = new Set<object>(), depth = 0, count = { value: 0 }): value is VaultValue {
  if (++count.value > 4096 || depth > 16) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= VAULT_LIMITS.recordBytes;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  if (!Array.isArray(value) && !object(value)) return false;
  if (Object.getOwnPropertySymbols(value).length) return false;
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
  if (entries.length > 257 || (Array.isArray(value) && value.length > 256)) return false;
  if (Array.isArray(value) && (entries.length !== value.length + 1 || entries.some(([key]) => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)))) return false;
  seen.add(value);
  for (const [key, descriptor] of entries) {
    if (Array.isArray(value) && key === 'length') continue;
    if (forbidden.has(key) || !('value' in descriptor) || !descriptor.enumerable || !jsonValue(descriptor.value, seen, depth + 1, count)) {
      seen.delete(value); return false;
    }
  }
  seen.delete(value);
  return true;
}

function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}

function bytes(text: unknown, length?: number): Uint8Array | null {
  if (typeof text !== 'string' || text.length > VAULT_LIMITS.envelopeCharacters || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const decoded = atob(text);
    if (length !== undefined && decoded.length !== length) return null;
    const out = Uint8Array.from(decoded, c => c.charCodeAt(0));
    return base64(out) === text ? out : null;
  } catch { return null; }
}

function buffer(value: Uint8Array): ArrayBuffer { return new Uint8Array(value).buffer; }

function envelope(raw: string): Envelope | null {
  if (!raw || raw.length > VAULT_LIMITS.envelopeCharacters) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || !keys(value, ['version', 'kdf', 'cipher']) || value.version !== 1) return null;
    const kdf = value.kdf, cipher = value.cipher;
    if (!object(kdf) || !keys(kdf, ['name', 'hash', 'iterations', 'salt']) || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || kdf.iterations !== VAULT_LIMITS.iterations || !bytes(kdf.salt, 16)) return null;
    if (!object(cipher) || !keys(cipher, ['name', 'iv', 'data']) || cipher.name !== 'AES-GCM' || !bytes(cipher.iv, 12)) return null;
    const encrypted = bytes(cipher.data);
    if (!encrypted || encrypted.length < 17 || encrypted.length > VAULT_LIMITS.plaintextBytes + 16) return null;
    return value as unknown as Envelope;
  } catch { return null; }
}

function payload(value: unknown): Payload | null {
  if (!object(value) || !keys(value, ['version', 'records']) || value.version !== 1 || !object(value.records)) return null;
  const records = value.records;
  if (Object.keys(records).length > VAULT_LIMITS.records) return null;
  for (const [key, record] of Object.entries(records)) {
    if (!keyValid(key) || !jsonValue(record) || encoder.encode(JSON.stringify(record)).length > VAULT_LIMITS.recordBytes) return null;
  }
  return { version: 1, records: Object.assign(Object.create(null), records) as Record<string, VaultValue> };
}

function authenticatedHeader(value: Envelope): ArrayBuffer {
  return buffer(encoder.encode(JSON.stringify({ context: 'SpatialDesk private vault', version: value.version, kdf: value.kdf, cipher: value.cipher.name })));
}

/**
 * Encryption protects a stored/exported copy; it cannot protect an unlocked page from malicious scripts.
 * The UI must request explicit consent for creation/import/deletion, never send the passphrase to voice or AI,
 * and call lock() when the user leaves the private view. No clinical or regulatory certification is implied.
 */
export class PrivateVault {
  private material: CryptoKey | null = null;
  private content: Payload | null = null;
  private raw: string | null = null;
  private epoch = 0;
  private queued = 0;
  private queue: Promise<void> = Promise.resolve();
  private failure: VaultError | null = null;

  constructor(private readonly storage?: VaultStorage) {}

  get isUnlocked(): boolean { return this.material !== null && this.content !== null; }
  get isBusy(): boolean { return this.queued > 0; }
  get error(): VaultError | null { return this.failure && { ...this.failure }; }
  get lastError(): VaultError | null { return this.error; }

  lock(): void {
    ++this.epoch;
    this.material = null;
    this.content = null;
    this.raw = null;
    this.failure = null;
  }

  async unlock(passphrase: string): Promise<boolean> {
    this.lock();
    const generation = this.epoch;
    return this.enqueue(async () => {
      if (generation !== this.epoch) return this.fail('conflict');
      if (typeof passphrase !== 'string') return this.fail('passphrase');
      const normalized = passphrase.normalize('NFC');
      const length = Array.from(normalized).length;
      if (length < 12 || length > 256 || !normalized.trim()) return this.fail('passphrase');
      const crypto = globalThis.crypto;
      if (!crypto?.subtle) return this.fail('unavailable');
      const read = this.readRaw();
      if (!read.ok) return false;
      const encoded = read.value === null ? null : envelope(read.value);
      if (read.value !== null && !encoded) return this.fail('corrupt');
      const secret = encoder.encode(normalized);
      let material: CryptoKey;
      try { material = await crypto.subtle.importKey('raw', buffer(secret), 'PBKDF2', false, ['deriveKey']); }
      catch { return this.fail('unavailable'); }
      finally { secret.fill(0); }
      let data: Payload = { version: 1, records: Object.create(null) as Record<string, VaultValue> };
      if (encoded) {
        let decrypted: ArrayBuffer;
        try {
          const aes = await this.derive(material, bytes(encoded.kdf.salt)!);
          decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(bytes(encoded.cipher.iv)!), additionalData: authenticatedHeader(encoded), tagLength: 128 }, aes, buffer(bytes(encoded.cipher.data)!));
        } catch { return generation === this.epoch ? this.fail('authentication') : this.fail('conflict'); }
        try {
          if (decrypted.byteLength > VAULT_LIMITS.plaintextBytes) return this.fail('capacity');
          const parsed = payload(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decrypted)));
          if (!parsed) return this.fail('corrupt');
          data = parsed;
        } catch { return this.fail('corrupt'); }
        finally { new Uint8Array(decrypted).fill(0); }
      }
      if (generation !== this.epoch) return this.fail('conflict');
      this.material = material;
      this.content = data;
      this.raw = read.value;
      if (!this.matchesStorage()) return false;
      if (read.value === null && !await this.commit(data, generation)) { this.material = null; this.content = null; this.raw = null; return false; }
      this.failure = null;
      return true;
    });
  }

  async read<T = VaultValue>(key: string): Promise<T | null> {
    const generation = this.epoch;
    return this.enqueue(async () => {
      if (!this.ready(generation)) return null;
      if (!keyValid(key)) { this.fail('invalid'); return null; }
      const value = this.content!.records[key];
      this.failure = null;
      return value === undefined ? null : JSON.parse(JSON.stringify(value)) as T;
    });
  }

  async put(key: string, value: unknown): Promise<boolean> {
    const generation = this.epoch;
    // Snapshot before awaiting so the caller cannot mutate a queued value after authorising it.
    let clean: VaultValue;
    try {
      if (!keyValid(key) || !jsonValue(value)) return this.fail('invalid');
      const json = JSON.stringify(value);
      if (encoder.encode(json).length > VAULT_LIMITS.recordBytes) return this.fail('capacity');
      clean = JSON.parse(json) as VaultValue;
    } catch { return this.fail('invalid'); }
    return this.enqueue(async () => {
      if (!this.ready(generation)) return false;
      const records = Object.assign(Object.create(null), this.content!.records, { [key]: clean }) as Record<string, VaultValue>;
      return this.commit({ version: 1, records }, generation);
    });
  }

  async remove(key: string): Promise<boolean> {
    const generation = this.epoch;
    return this.enqueue(async () => {
      if (!this.ready(generation)) return false;
      if (!keyValid(key)) return this.fail('invalid');
      if (!(key in this.content!.records)) { this.failure = null; return true; }
      const records = Object.assign(Object.create(null), this.content!.records) as Record<string, VaultValue>;
      delete records[key];
      return this.commit({ version: 1, records }, generation);
    });
  }

  /** Destructive: the interface must ask the user to confirm. This also permits a forgotten-passphrase reset. */
  async clear(): Promise<boolean> {
    this.lock();
    const generation = this.epoch;
    return this.enqueue(async () => {
      if (generation !== this.epoch) return this.fail('conflict');
      try { this.store().removeItem(PRIVATE_VAULT_KEY); this.failure = null; return true; }
      catch { return this.fail('storage'); }
    });
  }

  exportEncrypted(): string | null {
    if (this.isBusy) { this.fail('conflict'); return null; }
    const read = this.readRaw();
    if (!read.ok || read.value === null) return null;
    if (!envelope(read.value)) { this.fail('corrupt'); return null; }
    this.failure = null;
    return read.value;
  }

  /** Import into an empty locked vault only. Replacement requires a separately confirmed clear(). */
  importEncrypted(raw: string): boolean {
    if (this.isUnlocked || this.isBusy) return this.fail('conflict');
    if (typeof raw !== 'string' || !envelope(raw)) return this.fail('corrupt');
    const read = this.readRaw();
    if (!read.ok) return false;
    if (read.value !== null) return this.fail('conflict');
    try { this.store().setItem(PRIVATE_VAULT_KEY, raw); this.failure = null; return true; }
    catch { return this.fail('storage'); }
  }

  private store(): VaultStorage { return this.storage ?? globalThis.localStorage; }

  private readRaw(): { ok: true; value: string | null } | { ok: false } {
    try {
      const value = this.store().getItem(PRIVATE_VAULT_KEY);
      if (value !== null && typeof value !== 'string') { this.fail('corrupt'); return { ok: false }; }
      return { ok: true, value };
    } catch { this.fail('storage'); return { ok: false }; }
  }

  private matchesStorage(): boolean {
    const read = this.readRaw();
    if (!read.ok) return false;
    if (read.value !== this.raw) { this.lock(); return this.fail('conflict'); }
    return true;
  }

  private ready(generation: number): boolean {
    if (generation !== this.epoch) return this.fail('conflict');
    if (!this.isUnlocked) return this.fail('locked');
    return this.matchesStorage();
  }

  private derive(material: CryptoKey, salt: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buffer(salt), iterations: VAULT_LIMITS.iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  private async commit(data: Payload, generation: number): Promise<boolean> {
    if (!this.ready(generation)) return false;
    if (Object.keys(data.records).length > VAULT_LIMITS.records) return this.fail('capacity');
    const plain = encoder.encode(JSON.stringify(data));
    if (plain.length > VAULT_LIMITS.plaintextBytes) return this.fail('capacity');
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const next: Envelope = { version: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: VAULT_LIMITS.iterations, salt: base64(salt) }, cipher: { name: 'AES-GCM', iv: base64(iv), data: '' } };
    try {
      const aes = await this.derive(this.material!, salt);
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(iv), additionalData: authenticatedHeader(next), tagLength: 128 }, aes, buffer(plain));
      next.cipher.data = base64(new Uint8Array(encrypted));
    } catch { return this.fail('unavailable'); }
    finally { plain.fill(0); }
    if (!this.ready(generation)) return false;
    const raw = JSON.stringify(next);
    if (raw.length > VAULT_LIMITS.envelopeCharacters) return this.fail('capacity');
    try { this.store().setItem(PRIVATE_VAULT_KEY, raw); }
    catch { return this.fail('storage'); }
    this.raw = raw;
    this.content = data;
    this.failure = null;
    return true;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.queued++;
    const result = this.queue.then(operation).finally(() => { this.queued--; });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private fail(code: VaultErrorCode): false { this.failure = { code, message: messages[code] }; return false; }
}
