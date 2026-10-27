import assert from 'node:assert/strict';
import { calibrateRecording, markerColour, fingerprintTree, validateIdentity, validateRecording } from '../scripts/video-contract.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = { beats: [{ id: 'enter' }, { id: 'say' }, { id: 'end' }] };
const marks = [{ id: 'enter', at: 100 }, { id: 'say', at: 1500 }];
validateRecording(script, marks, { enter: 1, say: 2, end: 1 });
assert.throws(() => validateRecording(script, [{ id: 'describe', at: 100 }]), /does not match/);
assert.throws(() => validateRecording(script, [...marks].reverse()), /does not match/);
assert.throws(() => validateRecording(script, [{ id: 'enter', at: 100 }, { id: 'say', at: 100 }]), /increasing/);
assert.throws(() => validateRecording(script, marks, { enter: 1, say: 0, end: 1 }), /duration/);
assert.throws(() => validateRecording(script, [{ id: 'enter', at: NaN }, marks[1]]), /timestamps/);
assert.throws(() => validateRecording(script, []), /no markers/);
assert.throws(() => validateIdentity(null, { narration: 'new' }), /unverified/);
assert.throws(() => validateIdentity({ narration: 'old' }, { narration: 'new' }), /narration/);
assert.throws(() => validateIdentity({ recording: 'take-1' }, { recording: 'take-2' }), /recording/);
validateIdentity({ narration: 'same', recording: 'same' }, { narration: 'same', recording: 'same' });
const frames = Buffer.from([0, 0, 0, ...markerColour(0), ...markerColour(0), 0, 0, 0, ...markerColour(1), ...markerColour(1)]);
const synced = calibrateRecording(marks, frames);
assert.equal(synced[0].at, 100);
assert.equal(synced[0].end, 0.3);
assert.equal(synced[1].at, 400);
assert.equal(synced[1].clockAt, 1500);
assert.throws(() => calibrateRecording(marks, Buffer.from(markerColour(0))), /Missing/);
const fixture = mkdtempSync(join(tmpdir(), 'spatialdesk-video-'));
try {
  mkdirSync(join(fixture, 'src'));
  writeFileSync(join(fixture, 'src', 'app.ts'), 'current app');
  const before = fingerprintTree(fixture, ['src']);
  writeFileSync(join(fixture, 'notes.txt'), 'unrelated');
  assert.equal(fingerprintTree(fixture, ['src']), before);
  writeFileSync(join(fixture, 'src', 'app.ts'), 'new feature');
  assert.notEqual(fingerprintTree(fixture, ['src']), before);
  assert.throws(() => validateIdentity({ app: before }, { app: fingerprintTree(fixture, ['src']) }), /app/);
} finally {
  assert.ok(fixture.startsWith(join(tmpdir(), 'spatialdesk-video-')));
  rmSync(fixture, { recursive: true, force: true });
}
console.log('Video contract: 19 checks passed.');
