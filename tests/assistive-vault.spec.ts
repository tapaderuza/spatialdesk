import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildTaskShare, filterConfigurationProposal, grantIsActive, SharingPermissions } from '../src/assistive/sharing.js';
import type { Workspace } from '../src/workspace/model.js';

type Win = Window & Record<string, any>;
const compiled = ts.transpileModule(readFileSync('src/assistive/vault.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;

async function harness(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:4173/private-vault-test', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><title>Private vault test</title></html>' }));
  await page.goto('http://127.0.0.1:4173/private-vault-test');
  await page.addScriptTag({ type: 'module', content: `${compiled}\nObject.assign(window, { PrivateVault, PRIVATE_VAULT_KEY, VAULT_LIMITS });` });
  await page.waitForFunction(() => !!(window as Win).PrivateVault);
  await page.evaluate(() => {
    (window as Win).makeStorage = () => {
      const values = new Map<string, string>();
      const control = { blocked: false, blockedRead: false };
      return { values, control, getItem: (k: string) => { if (control.blockedRead) throw Error('blocked'); return values.get(k) ?? null; },
        setItem: (k: string, v: string) => { if (control.blocked) throw Error('full'); values.set(k, v); },
        removeItem: (k: string) => { if (control.blocked) throw Error('blocked'); values.delete(k); } };
    };
  });
}

test.describe('private vault browser cryptography', () => {
  test.beforeEach(async ({ page }) => harness(page));

  test('Unicode passphrase, encrypted persistence, wrong password, lock and isolated read copies', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const w = window as Win, pass = 'Luna 🌙 mamá segura 2026', secret = 'Observación privada que nunca debe guardarse en claro 75219';
      const vault = new w.PrivateVault();
      const available = !!crypto.subtle;
      const created = await vault.unlock(pass);
      const saved = await vault.put('consultation', { observation: secret, questions: ['Mi propia pregunta'], when: '2026-10-27' });
      const raw = localStorage.getItem(w.PRIVATE_VAULT_KEY)!;
      const backup = vault.exportEncrypted();
      vault.lock();
      const lockedRead = await vault.read('consultation'), lockedCode = vault.error?.code;
      const reopened = new w.PrivateVault();
      const incorrect = await reopened.unlock('Esta frase no es la correcta 2026'), incorrectCode = reopened.error?.code;
      const unchanged = raw === localStorage.getItem(w.PRIVATE_VAULT_KEY);
      const correct = await reopened.unlock(pass);
      const record = await reopened.read('consultation');
      record.questions.push('No persistir esta edición');
      const copied = await reopened.read('consultation');
      return { available, created, saved, rawContainsSecret: raw.includes(secret) || raw.includes(pass), topKeys: Object.keys(JSON.parse(raw)).sort(), backup: backup === raw,
        lockedRead, lockedCode, incorrect, incorrectCode, unchanged, correct, copied, unlocked: reopened.isUnlocked, busy: reopened.isBusy };
    });
    expect(result).toMatchObject({ available: true, created: true, saved: true, rawContainsSecret: false, topKeys: ['cipher', 'kdf', 'version'], backup: true,
      lockedRead: null, lockedCode: 'locked', incorrect: false, incorrectCode: 'authentication', unchanged: true, correct: true, unlocked: true, busy: false });
    expect(result.copied.questions).toEqual(['Mi propia pregunta']);
  });

  test('every write has a new salt and IV; serialised writes preserve both records and snapshot input', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const w = window as Win, storage = w.makeStorage(), vault = new w.PrivateVault(storage);
      await vault.unlock('Una frase privada larga 2026');
      const first = JSON.parse(vault.exportEncrypted());
      const input = { text: 'lo autorizado' };
      const a = vault.put('first', input);
      input.text = 'modificación posterior';
      const b = vault.put('second', { text: 'segundo' });
      const success = await Promise.all([a, b]);
      const second = JSON.parse(vault.exportEncrypted());
      await vault.put('second', { text: 'segundo' });
      const third = JSON.parse(vault.exportEncrypted());
      return { success, first: await vault.read('first'), second: await vault.read('second'), salts: [first.kdf.salt, second.kdf.salt, third.kdf.salt], ivs: [first.cipher.iv, second.cipher.iv, third.cipher.iv] };
    });
    expect(result.success).toEqual([true, true]);
    expect(result.first).toEqual({ text: 'lo autorizado' });
    expect(result.second).toEqual({ text: 'segundo' });
    expect(new Set(result.salts).size).toBe(3);
    expect(new Set(result.ivs).size).toBe(3);
  });

  test('tampering is rejected, malicious format/iterations do not replace stored data', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const w = window as Win, storage = w.makeStorage(), vault = new w.PrivateVault(storage), pass = 'Una frase privada larga 2026';
      await vault.unlock(pass); await vault.put('observation', 'texto privado');
      const original = vault.exportEncrypted(); vault.lock();
      const tampered = JSON.parse(original);
      tampered.cipher.data = (tampered.cipher.data[0] === 'A' ? 'B' : 'A') + tampered.cipher.data.slice(1);
      storage.setItem(w.PRIVATE_VAULT_KEY, JSON.stringify(tampered));
      const authenticated = await vault.unlock(pass), authCode = vault.error?.code;
      const unchanged = storage.getItem(w.PRIVATE_VAULT_KEY) === JSON.stringify(tampered);
      storage.setItem(w.PRIVATE_VAULT_KEY, original);
      const costly = JSON.parse(original); costly.kdf.iterations = 2147483647;
      const importedCostly = vault.importEncrypted(JSON.stringify(costly)), costlyCode = vault.error?.code;
      const additional = JSON.parse(original); additional.observation = 'plaintext';
      const importedAdditional = vault.importEncrypted(JSON.stringify(additional));
      const oversized = vault.importEncrypted('x'.repeat(100001));
      storage.setItem(w.PRIVATE_VAULT_KEY, '{broken');
      const corrupt = await vault.unlock(pass), corruptCode = vault.error?.code;
      return { authenticated, authCode, unchanged, importedCostly, costlyCode, importedAdditional, oversized, corrupt, corruptCode, locked: !vault.isUnlocked };
    });
    expect(result).toEqual({ authenticated: false, authCode: 'authentication', unchanged: true, importedCostly: false, costlyCode: 'corrupt', importedAdditional: false, oversized: false, corrupt: false, corruptCode: 'corrupt', locked: true });
  });

  test('storage failures keep the old ciphertext and do not claim a successful change', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const w = window as Win, storage = w.makeStorage(), vault = new w.PrivateVault(storage), pass = 'Una frase privada larga 2026';
      storage.control.blockedRead = true;
      const readFailure = await vault.unlock(pass), readCode = vault.error?.code;
      storage.control.blockedRead = false; storage.control.blocked = true;
      const createFailure = await vault.unlock(pass), createCode = vault.error?.code, initiallyLocked = !vault.isUnlocked;
      storage.control.blocked = false;
      await vault.unlock(pass); await vault.put('note', { text: 'anterior' });
      const original = vault.exportEncrypted();
      storage.values.set('other-key', 'keep'); storage.control.blocked = true;
      const writeFailure = await vault.put('note', { text: 'no autorizado por almacenamiento' }), writeCode = vault.error?.code;
      const record = await vault.read('note');
      const deleteFailure = await vault.clear(), deleteCode = vault.error?.code, locked = !vault.isUnlocked;
      const preserved = storage.getItem(w.PRIVATE_VAULT_KEY) === original;
      storage.control.blocked = false;
      const deleted = await vault.clear();
      return { readFailure, readCode, createFailure, createCode, initiallyLocked, writeFailure, writeCode, record, deleteFailure, deleteCode, locked, preserved, deleted,
        empty: storage.getItem(w.PRIVATE_VAULT_KEY) === null, other: storage.getItem('other-key') };
    });
    expect(result).toEqual({ readFailure: false, readCode: 'storage', createFailure: false, createCode: 'storage', initiallyLocked: true,
      writeFailure: false, writeCode: 'storage', record: { text: 'anterior' }, deleteFailure: false, deleteCode: 'storage', locked: true, preserved: true, deleted: true, empty: true, other: 'keep' });
  });

  test('import remains locked and never overwrites an existing vault or an active operation', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const w = window as Win, source = new w.PrivateVault(w.makeStorage()), target = new w.PrivateVault(w.makeStorage()), pass = 'Una frase privada larga 2026';
      await source.unlock(pass); await source.put('note', { words: 'mi pista' });
      const backup = source.exportEncrypted();
      const imported = target.importEncrypted(backup), startsLocked = !target.isUnlocked;
      const beforeUnlock = await target.read('note');
      const success = await target.unlock(pass), record = await target.read('note');
      const whileOpen = target.importEncrypted(backup); target.lock();
      const replacement = target.importEncrypted(backup), replacementCode = target.error?.code;
      await target.clear();
      const pending = target.unlock(pass);
      const whilePending = target.importEncrypted(backup); target.lock();
      const cancelled = await pending;
      const deleted = await target.clear(), restored = target.importEncrypted(backup), restoredUnlock = await target.unlock(pass);
      return { imported, startsLocked, beforeUnlock, success, record, whileOpen, replacement, replacementCode, whilePending, cancelled, deleted, restored, restoredUnlock };
    });
    expect(result).toEqual({ imported: true, startsLocked: true, beforeUnlock: null, success: true, record: { words: 'mi pista' }, whileOpen: false, replacement: false,
      replacementCode: 'conflict', whilePending: false, cancelled: false, deleted: true, restored: true, restoredUnlock: true });
  });

  test('locking during encryption cancels the write and another instance cannot overwrite newer data', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const w = window as Win, storage = w.makeStorage(), first = new w.PrivateVault(storage), second = new w.PrivateVault(storage), pass = 'Una frase privada larga 2026';
      await first.unlock(pass); await first.put('note', 'original'); await second.unlock(pass);
      const before = first.exportEncrypted();
      const pending = first.put('note', 'no persistir después de bloquear');
      await Promise.resolve(); first.lock();
      const cancelled = await pending, remained = storage.getItem(w.PRIVATE_VAULT_KEY) === before;
      await first.unlock(pass); await first.put('note', 'nuevo');
      const stale = await second.put('note', 'sobrescritura obsoleta'), staleCode = second.error?.code;
      return { cancelled, remained, stale, staleCode, secondLocked: !second.isUnlocked, latest: await first.read('note') };
    });
    expect(result).toEqual({ cancelled: false, remained: true, stale: false, staleCode: 'conflict', secondLocked: true, latest: 'nuevo' });
  });

  test('passphrase, JSON shape, per-record and total limits reject changes without data loss', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const w = window as Win, vault = new w.PrivateVault(w.makeStorage());
      const short = await vault.unlock('corta'), shortCode = vault.error?.code;
      await vault.unlock('Una frase privada larga 2026');
      const cyclic: any = {}; cyclic.self = cyclic;
      const cycle = await vault.put('bad', cyclic);
      const reserved = await vault.put('__proto__', { innocent: true });
      const nonfinite = await vault.put('bad', { value: Infinity });
      const tooLarge = await vault.put('large', { note: 'x'.repeat(8185) }), sizeCode = vault.error?.code;
      for (let i = 0; i < 8; i++) await vault.put(`record-${i}`, 'x'.repeat(7800));
      const original = vault.exportEncrypted();
      const aggregate = await vault.put('overflow', 'x'.repeat(7800)), aggregateCode = vault.error?.code;
      const preserved = vault.exportEncrypted() === original;
      const notInserted = await vault.read('overflow');
      const removed = await vault.remove('record-0'), missing = await vault.read('record-0');
      return { short, shortCode, cycle, reserved, nonfinite, tooLarge, sizeCode, aggregate, aggregateCode, preserved, notInserted, removed, missing };
    });
    expect(result).toEqual({ short: false, shortCode: 'passphrase', cycle: false, reserved: false, nonfinite: false, tooLarge: false, sizeCode: 'capacity', aggregate: false,
      aggregateCode: 'capacity', preserved: true, notInserted: null, removed: true, missing: null });
  });
});

test.describe('sharing consent and field boundaries', () => {
  const workspace = { boards: [{ id: 'b1', title: 'private board name', columns: [{ title: 'To do', cards: [{ id: 'k1', title: 'Chosen task', health: 'never share', note: 'private' }, { id: 'k2', title: 'Not selected' }] }] }], timers: [{ cardId: 'k1', label: 'private clock' }], conversation: ['private dialogue'], comfort: { side: 'right' } } as unknown as Workspace;

  test('default shares nothing, selection copies only approved fields, revocation and expiry take effect', () => {
    const permissions = new SharingPermissions();
    expect(permissions.list(1000)).toEqual([]);
    expect(permissions.snapshotTasks(workspace, 'none', 1000)).toBeNull();
    expect(permissions.grant('task', [], 60000, 1000)).toBeNull();
    const grant = permissions.grant('task', ['k1'], 60000, 1000)!;
    grant.taskIds.push('k2'); // cannot mutate the stored consent through a returned object
    const snapshot = permissions.snapshotTasks(workspace, grant.id, 1001);
    expect(snapshot).toEqual({ version: 1, tasks: [{ id: 'k1', title: 'Chosen task', column: 'To do' }] });
    expect(JSON.stringify(snapshot)).not.toMatch(/private|health|note|clock|dialogue|comfort/);
    expect(permissions.snapshotTasks(workspace, grant.id, 61000)).toBeNull();
    expect(permissions.revoke(grant.id, 1002)).toBe(true);
    expect(permissions.snapshotTasks(workspace, grant.id, 1003)).toBeNull();
    expect(grantIsActive(permissions.get(grant.id), 'task', 1003)).toBe(false);
  });

  test('remote configuration is a bounded proposal and must be rechecked when accepted locally', () => {
    const permissions = new SharingPermissions();
    const grant = permissions.grant('config', [], 60000, 1000)!;
    const proposal = permissions.proposeConfiguration({ id: 'request-1', changes: { reach: 0.8, side: 'right', turnDeg: 30 } }, grant.id, 1001)!;
    expect(proposal).toMatchObject({ id: 'request-1', grantId: grant.id, requiresLocalApproval: true, changes: { reach: 0.8, side: 'right', turnDeg: 30 } });
    expect(workspace.comfort).toEqual({ side: 'right' });
    expect(permissions.mayApprove(proposal, 1002)).toBe(true);
    permissions.revoke(grant.id, 1003);
    expect(permissions.mayApprove(proposal, 1004)).toBe(false);
    expect(permissions.mayApprove(proposal, 61001)).toBe(false);
  });

  test('unrelated scopes, actions, malformed fields and inherited object keys are rejected', () => {
    const permissions = new SharingPermissions(), grant = permissions.grant('config', [], 60000, 1000)!;
    const help = permissions.grant('help', [], 60000, 1000)!;
    expect(buildTaskShare(workspace, help, 1001)).toBeNull();
    for (const input of [
      { id: 'x', changes: { reach: 999 } }, { id: 'x', changes: { scale: NaN } }, { id: 'x', changes: { side: {} } },
      { id: 'x', changes: { toString: 1 } }, JSON.parse('{"id":"x","changes":{"__proto__":1}}'),
      { id: 'x', changes: { reach: 0.8 }, apply: true }, { id: 'x', changes: { op: 'delete_board' } }, { id: 'x', changes: {} },
    ]) expect(filterConfigurationProposal(input, grant, 1001)).toBeNull();
    expect(filterConfigurationProposal({ id: 'x', changes: { reach: 0.8 } }, help, 1001)).toBeNull();
    expect(filterConfigurationProposal({ id: 'x', changes: { reach: 0.8 } }, grant, 999)).toBeNull();
    permissions.revokeAll(1002);
    expect(permissions.list(1003)).toEqual([]);
  });
});
