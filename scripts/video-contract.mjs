import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function fingerprint(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export const markerColour = (index) => [48 + 64 * (index % 4), 48 + 64 * Math.floor(index / 4), 208];

/** Match the recorder's actual frame clock, which can start before Playwright begins the test. */
export function calibrateRecording(marks, rgb, fps = 10) {
  const windows = marks.map(() => ({ start: Infinity, end: -Infinity }));
  let current = -1;
  for (let frame = 0; frame < rgb.length / 3; frame++) {
    let found = -1, distance = Infinity;
    marks.forEach((_, i) => {
      const colour = markerColour(i);
      const d = colour.reduce((sum, c, k) => sum + (c - rgb[frame * 3 + k]) ** 2, 0);
      if (d < distance) { found = i; distance = d; }
    });
    // VP8's RGB conversion can shift these small markers by roughly 20-30 levels.
    // Accept only the current colour or its immediate successor, never background lookalikes out of order.
    if (distance > 48 ** 2 || (found !== current && found !== current + 1)) continue;
    current = found;
    windows[found].start = Math.min(windows[found].start, frame / fps);
    windows[found].end = (frame + 1) / fps;
  }
  return marks.map((m, i) => {
    const w = windows[i];
    if (!Number.isFinite(w.start) || w.end <= w.start || (i && w.start < windows[i - 1].end)) throw new Error(`Missing or overlapping video timing marker: ${m.id}`);
    return { ...m, clockAt: m.at, at: Math.round(w.start * 1000), end: w.end };
  });
}

/** Include the actual app and planner, so old footage cannot pass just because its marker names still match. */
export function fingerprintTree(root, paths) {
  const hash = createHash('sha256');
  const visit = (path) => {
    if (statSync(path).isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
    else hash.update(relative(root, path).replaceAll('\\', '/')).update('\0').update(readFileSync(path)).update('\0');
  };
  for (const path of [...paths].sort()) visit(join(root, path));
  return hash.digest('hex');
}

export function validateRecording(script, marks, durations) {
  if (!Array.isArray(marks) || !marks.length) throw new Error('Recording has no markers. Record again.');
  const expected = script.beats.filter((beat) => beat.id !== 'end').map((beat) => beat.id);
  const actual = marks.map((mark) => mark.id);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Recording does not match the current narration. Record again without --edit. '
      + `Expected: ${expected.join(', ')}. Recorded: ${actual.join(', ')}.`);
  }
  for (let i = 0; i < marks.length; i++) {
    if (!Number.isFinite(marks[i].at) || marks[i].at < 0 || (i && marks[i].at <= marks[i - 1].at)) {
      throw new Error('Recording timestamps must be finite, positive and strictly increasing.');
    }
  }
  if (durations) {
    for (const beat of script.beats) {
      if (!Number.isFinite(durations[beat.id]) || durations[beat.id] <= 0) {
        throw new Error(`Missing or invalid voice duration: ${beat.id}`);
      }
    }
  }
}

// Bind a capture to its exact script, test, pacing and bytes. Matching IDs alone
// cannot detect a rewritten line or a video copied from another take.
export function captureIdentity(paths) {
  return Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fingerprint(path)]));
}

export function validateIdentity(saved, current) {
  for (const [key, value] of Object.entries(current)) {
    if (saved?.[key] !== value) throw new Error(`Stale or unverified recording (${key}). Record again without --edit.`);
  }
}
