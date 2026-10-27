/**
 * Tremor mode (src/ui/aim.ts) against synthetic tremor, on the command panel's real button grid (10 x 8 cm buttons,
 * three to a row, 1 cm apart). A person aims at each button for 0.6 s while the ray sweeps around it: a 4 to 6 Hz
 * tremor of 3.5 cm along one axis and a third of that across it, a slow drift and sensor noise; then the pinch jolts
 * the ray 2.5 cm. Without tremor mode the control under the ray at the press is pressed; with it, the one aimed at
 * for most of the last 450 ms (a press between controls snaps to one within 1.5 cm). The same trials run both ways.
 *
 * Run at two strengths, moderate and strong. A model of selection to compare the two modes, not a clinical measure: the
 * numbers go to test-results/tremor-<strength>.json.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { AimTrail, outside, SNAP_METRES } from '../src/ui/aim.js';
import { openWorkspace, screenPoint } from './helpers.js';

const GRID = { columns: 3, rows: 5, width: 0.1, height: 0.08, gapX: 0.01, gapY: 0.012 };
/** Two strengths: moderate (3.5 cm, a 2.5 cm jolt) and strong (5 cm, 3 cm), the strong one beyond the buttons' half height. */
const LEVELS = [
  { name: 'moderate', amplitude: 0.035, pressSlip: 0.025, minOn: 0.95, minWorst: 0.9 },
  { name: 'strong', amplitude: 0.05, pressSlip: 0.03, minOn: 0.9, minWorst: 0.8 },
] as const;
const SHAPE = { across: 0.33, minHz: 4, maxHz: 6, driftMetres: 0.008, noiseMetres: 0.002 };
const AIM = { seconds: 0.6, hz: 72, windowMs: 450, trialsPerButton: 200, seed: 20261027 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Button { x: number; y: number }

const buttons: Button[] = [];
for (let r = 0; r < GRID.rows; r++) {
  for (let c = 0; c < GRID.columns; c++) buttons.push({ x: c * (GRID.width + GRID.gapX), y: -r * (GRID.height + GRID.gapY) });
}

/** The button under a point, as the panel's rectangle test finds it; -1 between buttons. */
const under = (x: number, y: number) => buttons.findIndex((b) => outside(x - b.x, y - b.y, GRID.width, GRID.height) === 0);

/** The nearest button within [SNAP_METRES] of a point that is on none. */
function nearest(x: number, y: number): number {
  let best = -1;
  let bestDistance = SNAP_METRES;
  buttons.forEach((b, i) => {
    const d = outside(x - b.x, y - b.y, GRID.width, GRID.height);
    if (d <= bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

for (const level of LEVELS) test(`tremor mode, ${level.name} tremor: the button aimed at is pressed despite the sweep and the jolt of the pinch`, () => {
  const TREMOR = { ...SHAPE, ...level };
  const rand = mulberry32(AIM.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const trail = new AimTrail();
  const tally = new Float64Array(buttons.length);
  const perButton = buttons.map(() => ({ off: 0, on: 0, wrongOn: 0 }));
  const samples = Math.round(AIM.seconds * AIM.hz);

  buttons.forEach((target, b) => {
    for (let trial = 0; trial < AIM.trialsPerButton; trial++) {
      const hz = TREMOR.minHz + rand() * (TREMOR.maxHz - TREMOR.minHz);
      const phase = rand() * 2 * Math.PI;
      const axis = rand() * Math.PI;
      const [ux, uy] = [Math.cos(axis), Math.sin(axis)];
      const drift = rand() * 2 * Math.PI;
      const point = (t: number): [number, number] => {
        const along = TREMOR.amplitude * Math.sin(2 * Math.PI * hz * t + phase);
        const across = TREMOR.amplitude * TREMOR.across * Math.sin(2 * Math.PI * hz * t + phase + Math.PI / 2);
        const slow = (TREMOR.driftMetres * t) / AIM.seconds;
        return [
          target.x + along * ux - across * uy + slow * Math.cos(drift) + gauss() * TREMOR.noiseMetres,
          target.y + along * uy + across * ux + slow * Math.sin(drift) + gauss() * TREMOR.noiseMetres,
        ];
      };
      trail.clear();
      for (let s = 0; s < samples; s++) {
        const [x, y] = point(s / AIM.hz);
        trail.record((s * 1000) / AIM.hz, under(x, y));
      }
      // The pinch: the ray jumps as the fingers close.
      const slip = rand() * 2 * Math.PI;
      const [px, py] = point(AIM.seconds);
      const [x, y] = [px + TREMOR.pressSlip * Math.cos(slip), py + TREMOR.pressSlip * Math.sin(slip)];
      const now = AIM.seconds * 1000;

      if (under(x, y) === b) perButton[b].off++;
      const aimed = trail.intended(now, AIM.windowMs, tally);
      const chosen = aimed >= 0 ? aimed : under(x, y) >= 0 ? under(x, y) : nearest(x, y);
      if (chosen === b) perButton[b].on++;
      else if (chosen >= 0) perButton[b].wrongOn++;
    }
  });

  const trials = buttons.length * AIM.trialsPerButton;
  const off = perButton.reduce((n, p) => n + p.off, 0) / trials;
  const on = perButton.reduce((n, p) => n + p.on, 0) / trials;
  const wrong = perButton.reduce((n, p) => n + p.wrongOn, 0) / trials;
  const worstOn = Math.min(...perButton.map((p) => p.on / AIM.trialsPerButton));
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    `test-results/tremor-${level.name}.json`,
    JSON.stringify({ date: new Date().toISOString(), grid: GRID, tremor: TREMOR, aim: AIM, off, on, wrongOn: wrong, worstButtonOn: worstOn }, null, 2),
  );
  console.log(`tremor ${level.name}: ${(off * 100).toFixed(1)}% without tremor mode, ${(on * 100).toFixed(1)}% with it (worst button ${(worstOn * 100).toFixed(1)}%, wrong ${(wrong * 100).toFixed(1)}%)`);

  expect(on).toBeGreaterThanOrEqual(level.minOn);
  expect(worstOn).toBeGreaterThanOrEqual(level.minWorst);
  expect(wrong).toBeLessThanOrEqual(0.03); // a wrong press is worse than none: it acts
  expect(on - off).toBeGreaterThanOrEqual(0.15); // tremor mode makes a real difference
});

test('steady aim: a control needs a real share of the recent aim, and old samples do not count', () => {
  const trail = new AimTrail(8);
  const tally = new Float64Array(3);
  for (let t = 0; t < 400; t += 50) trail.record(t, t < 300 ? 1 : 2); // mostly on 1, then on 2
  expect(trail.intended(400, 450, tally)).toBe(1);
  expect(trail.intended(2000, 450, tally)).toBe(2); // only the newest sample is within the window, held until now
  trail.clear();
  for (let t = 0; t < 400; t += 50) trail.record(t, t % 100 === 0 ? 0 : -1); // half the time on nothing
  expect(trail.intended(400, 450, tally, 0.6)).toBe(-1);
});

test('steady aim by voice: tremor mode on and off, and a hand that shakes said in a word', async () => {
  const { parseCommand } = await import('../src/voice/commands.js');
  expect(parseCommand('Tremor mode on.')).toEqual({ kind: 'steady', value: true });
  expect(parseCommand('Steady aim off')).toEqual({ kind: 'steady', value: false });
  expect(parseCommand('modo temblor')).toEqual({ kind: 'steady' });
  expect(parseCommand('My hands shake')).toEqual({ kind: 'steady', value: true });
  expect(parseCommand('Me tiemblan las manos')).toEqual({ kind: 'steady', value: true });
  // A longer sentence is the agent's: it adapts the space as well.
  expect(parseCommand("I have a tremor and I can't turn my neck")?.kind).toBe('comfort');
});

// The real path: mouse moves on the 2D command panel reach the same panel hit test as a hand's ray.
for (const steady of [false, true]) {
  test(`steady aim in the app (${steady ? 'on' : 'off'}): a shaky hover on Contrast, then the press slips onto Sound`, async ({ page }) => {
    const errors = await openWorkspace(page, steady ? '?steady' : '');
    const target = await screenPoint(page, 'command:contrast-button');
    const [left, right] = [await screenPoint(page, 'command:contrast-button', -0.5, 0), await screenPoint(page, 'command:contrast-button', 0.5, 0)];
    const half = (right.x - left.x) / 2;
    // About 450 ms of a hand shaking around Contrast, mostly across it.
    await page.mouse.move(target.x, target.y);
    for (let i = 0; i < 24; i++) {
      await page.mouse.move(target.x + Math.sin(i * 1.3) * half * 0.7, target.y + Math.cos(i * 1.7) * half * 0.15);
      await page.waitForTimeout(18);
    }
    // The jolt of the press lands inside Sound, Contrast's right-hand neighbour.
    const slip = await screenPoint(page, 'command:sound-button', -0.3, 0);
    await page.mouse.move(slip.x, slip.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
    const chosen = await page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.settings') ?? '{}'));
    if (steady) expect(chosen).toMatchObject({ highContrast: true }); // what she aimed at
    else expect(chosen).toMatchObject({ highContrast: false, sound: false }); // the neighbour under the jolt
    if (steady) expect(chosen.sound ?? true).toBe(true);
    expect(errors).toEqual([]);
  });
}
