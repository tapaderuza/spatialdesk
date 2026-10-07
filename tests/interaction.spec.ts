/**
 * Interaction gate (ROADMAP heuristic A), on the production build in the IWER Quest 3 emulator. No headset is used
 * at any point, so these numbers stand in for hands-on testing:
 *  1. every interactive target is at least 6 x 6 cm in the world, and every poke target is within arm reach;
 *  2. synthetic hand-ray noise (ray origin +-1 cm per axis, direction anywhere inside a 3 degree cone, weighted to
 *     the rim): every target keeps >= 95% of the taps aimed at it, and a tap that lands on another control counts
 *     as a failure (an accidental trigger);
 *  3. a complete manual flow driven by real pointer events (mouse on the canvas, the same path as a ray):
 *     pick a card, drop it, undo, Focus 25, reload (persisted), and a timer rings.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const MIN_TARGET_M = 0.06;
/** Comfortable poke reach from the shoulder for an adult arm (about 0.7 m arm length, elbow slightly bent). */
const ARM_REACH_M = 0.75;
const NOISE = { originMetres: 0.01, coneDegrees: 3, raysPerTarget: 400, minHitRate: 0.95, seed: 20261007 };

type Win = Window & Record<string, any>;

async function openWorkspace(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/${query}`);
  await page.waitForFunction(() => {
    const w = (window as Win).__world;
    let ready = false;
    w?.scene.traverse((o: any) => {
      if (o.name === 'b1:card-0-0' && o.size?.value?.[0] > 0) ready = true;
    });
    return ready;
  }, null, { timeout: 60_000 });
  return errors;
}

async function enterXR(page: Page): Promise<void> {
  await openWorkspace(page, '?emulate');
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await page.waitForTimeout(1500); // panel placement frames and layout
}

interface Target {
  name: string;
  item: string;
  id: string;
  center: Vec;
  u: Vec;
  v: Vec;
  chain: string[];
  interactive: boolean;
  root: boolean;
}

/** Controls and panel planes as world-space rectangles: center plus half-extent vectors. */
async function collectTargets(page: Page) {
  return page.evaluate(() => {
    const w = (window as Win).__world;
    const interactive = /^(card-\d-\d|col-\d|focus|board|toggle|add|dismiss|handle|[a-z]+-button)$/;
    const roots = /^(board|timer|command-root|handle)$/;
    const out: any[] = [];
    w.scene.updateMatrixWorld(true);
    w.scene.traverse((o: any) => {
      const m = /^(b\d+|t\d+|command):(.+)$/.exec(o.name ?? '');
      if (!m || !(interactive.test(m[2]) || roots.test(m[2]))) return;
      if (o.isVisible && !o.isVisible.value) return; // UIKit element hidden with display: none
      if (!o.isVisible) for (let p = o; p; p = p.parent) if (p.visible === false) return; // plain meshes
      // UIKit computes an element's matrixWorld lazily (when something raycasts or asks for it): ask.
      o.updateWorldMatrix(true, false);
      const e = o.matrixWorld.elements as number[];
      let u: number[];
      let v: number[];
      if (o.isVisible) {
        // UIKit: matrixWorld maps the unit square onto the element.
        u = [e[0] / 2, e[1] / 2, e[2] / 2];
        v = [e[4] / 2, e[5] / 2, e[6] / 2];
      } else {
        const p = o.geometry.parameters;
        u = [(e[0] * p.width) / 2, (e[1] * p.width) / 2, (e[2] * p.width) / 2];
        v = [(e[4] * p.height) / 2, (e[5] * p.height) / 2, (e[6] * p.height) / 2];
      }
      const chain: string[] = [];
      for (let p = o.parent; p; p = p.parent) if (typeof p.name === 'string' && p.name.startsWith(`${m[1]}:`)) chain.push(p.name);
      out.push({
        name: o.name,
        item: m[1],
        id: m[2],
        center: [e[12], e[13], e[14]],
        u,
        v,
        chain,
        interactive: interactive.test(m[2]) && m[2] !== 'command-root',
        root: roots.test(m[2]),
      });
    });
    const ws = (window as Win).__workspace.state;
    const eye = w.camera.getWorldPosition(new w.camera.position.constructor()).toArray();
    return { targets: out, focusBoardId: ws.focusBoardId as string, eye: eye as number[], anchorYaw: ws.anchor.yaw as number };
  });
}

type Vec = number[];
const sub = (a: Vec, b: Vec) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec, b: Vec) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, s: number) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec) => scale(a, 1 / len(a));

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ray against a target's rectangle: distance along the ray, or null. */
function hit(origin: Vec, dir: Vec, t: Target): number | null {
  const n = cross(t.u, t.v);
  const denom = dot(dir, n);
  if (Math.abs(denom) < 1e-9) return null;
  const s = dot(sub(t.center, origin), n) / denom;
  if (s <= 0) return null;
  const local = sub(add(origin, scale(dir, s)), t.center);
  const a = dot(local, t.u) / dot(t.u, t.u);
  const b = dot(local, t.v) / dot(t.v, t.v);
  return Math.abs(a) <= 1 && Math.abs(b) <= 1 ? s : null;
}

/** Which panel a control belongs to: the board, timer or command panel it sits on, or the grab bar itself. */
const panelKey = (t: Target) => (t.id === 'handle' ? t.name : t.item);

test('every interactive target is at least 6 x 6 cm', async ({ page }) => {
  await enterXR(page);
  const { targets } = await collectTargets(page);
  const sizes = (targets as Target[]).filter((t) => t.interactive).map((t) => ({ name: t.name, w: 2 * len(t.u), h: 2 * len(t.v) }));
  const small = sizes.filter((s) => s.w < MIN_TARGET_M - 1e-4 || s.h < MIN_TARGET_M - 1e-4);
  console.log(`${sizes.length} targets; smallest side ${Math.min(...sizes.map((s) => Math.min(s.w, s.h))).toFixed(3)} m`);
  expect(sizes.length).toBeGreaterThan(20);
  expect(small, `targets under 6 cm: ${JSON.stringify(small)}`).toEqual([]);
});

test('everything meant to be poked is within arm reach', async ({ page }) => {
  await enterXR(page);
  const { targets, focusBoardId, eye, anchorYaw } = await collectTargets(page);
  const right = [Math.cos(anchorYaw), 0, -Math.sin(anchorYaw)];
  const shoulders = [-1, 1].map((side) => add(add(eye, scale(right, 0.18 * side)), [0, -0.25, 0]));
  // Poke targets: the command panel, the timers, and the focus board (parked boards are pinch-only, by design).
  const pokeable = (targets as Target[]).filter((t) => t.interactive && (t.item === 'command' || t.item.startsWith('t') || t.item === focusBoardId));
  const far = pokeable
    .map((t) => ({ name: t.name, reach: Math.min(...shoulders.map((s) => len(sub(t.center, s)))) }))
    .filter((r) => r.reach > ARM_REACH_M);
  expect(pokeable.length).toBeGreaterThan(10);
  expect(far, `out of reach (> ${ARM_REACH_M} m from a shoulder): ${JSON.stringify(far)}`).toEqual([]);
});

test('taps survive synthetic hand-tracking noise (origin +-1 cm, 3 degree cone)', async ({ page }) => {
  await enterXR(page);
  const { targets: all, focusBoardId, eye, anchorYaw } = await collectTargets(page);
  const targets = all as Target[];
  const planes = targets.filter((t) => t.root);

  // What counts as success: parked boards act per column and per board; the focus board per card.
  const isParked = (t: Target) => t.item.startsWith('b') && t.item !== focusBoardId;
  const aimed = targets.filter((t) => t.interactive && !(isParked(t) && t.id.startsWith('card-')) && !(t.id === 'board' && !isParked(t)));
  // On a parked board every tap brings it within reach, so the "Bring here" button and the board share one action.
  const sameAction = (target: Target, landed: Target) =>
    landed.name === target.name ||
    ((target.id.startsWith('col-') || target.id === 'board') && landed.chain.includes(target.name)) ||
    (isParked(target) && (target.id === 'focus' || target.id === 'board') && landed.item === target.item);

  const rand = mulberry32(NOISE.seed);
  const right = [Math.cos(anchorYaw), 0, -Math.sin(anchorYaw)];
  const report: { name: string; rate: number; wrong: number }[] = [];

  for (const target of aimed) {
    // Meta's hand ray runs from an estimated shoulder through the hand, and a pointing arm is raised toward the
    // target: the ray starts at the hand, 30 cm out along the shoulder-target line, on the target's side.
    const side = dot(sub(target.center, eye), right) < -0.1 ? -1 : 1;
    const shoulder = add(add(eye, scale(right, 0.18 * side)), [0, -0.25, 0]);
    const hand = add(shoulder, scale(norm(sub(target.center, shoulder)), 0.3));
    let hits = 0;
    let wrong = 0;
    for (let i = 0; i < NOISE.raysPerTarget; i++) {
      const origin = hand.map((c) => c + (rand() * 2 - 1) * NOISE.originMetres);
      const ideal = norm(sub(target.center, origin));
      // Uniform over the cone's area: more samples near the 3 degree rim than a Gaussian would give.
      const angle = ((NOISE.coneDegrees * Math.PI) / 180) * Math.sqrt(rand());
      const spin = rand() * 2 * Math.PI;
      const helper = Math.abs(ideal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const p = norm(cross(ideal, helper));
      const q = cross(ideal, p);
      const offAxis = add(scale(p, Math.cos(spin)), scale(q, Math.sin(spin)));
      const dir = norm(add(scale(ideal, Math.cos(angle)), scale(offAxis, Math.sin(angle))));

      // The nearest panel the ray meets (occlusion), then the most specific control on it.
      let nearest: { key: string; s: number } | null = null;
      for (const plane of planes) {
        const s = hit(origin, dir, plane);
        if (s != null && (!nearest || s < nearest.s)) nearest = { key: panelKey(plane), s };
      }
      if (!nearest) continue;
      let landed: Target | null = null;
      for (const t of targets) {
        if (!t.interactive || panelKey(t) !== nearest.key || hit(origin, dir, t) == null) continue;
        if (!landed || t.chain.length > landed.chain.length) landed = t;
      }
      if (landed && sameAction(target, landed)) hits++;
      else if (landed) wrong++;
    }
    report.push({ name: target.name, rate: hits / NOISE.raysPerTarget, wrong });
  }

  report.sort((a, b) => a.rate - b.rate);
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/interaction-report.json', JSON.stringify({ date: new Date().toISOString(), noise: NOISE, focusBoardId, targets: report }, null, 2));
  console.log(`${report.length} targets; worst: ${report.slice(0, 5).map((r) => `${r.name} ${(r.rate * 100).toFixed(1)}%`).join(', ')}`);
  expect(report.length).toBeGreaterThanOrEqual(15);
  const failing = report.filter((r) => r.rate < NOISE.minHitRate);
  expect(failing, `targets under ${NOISE.minHitRate * 100}%: ${JSON.stringify(failing)}`).toEqual([]);
});

/** Screen position (CSS px) of a point on a named element; (u, v) in [-0.5, 0.5] across it. */
async function screenPoint(page: Page, name: string, u = 0, v = 0): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ name, u, v }) => {
      const w = (window as Win).__world;
      let o: any = null;
      w.scene.traverse((c: any) => {
        if (c.name === name) o = c;
      });
      if (!o) throw new Error(`no element ${name}`);
      o.updateWorldMatrix(true, false); // UIKit computes element matrices lazily
      const p = new w.camera.position.constructor(u, v, 0).applyMatrix4(o.matrixWorld).project(w.camera);
      const rect = w.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    },
    { name, u, v },
  );
}

async function tap(page: Page, name: string, u = 0, v = 0): Promise<void> {
  const { x, y } = await screenPoint(page, name, u, v);
  await page.mouse.move(x - 12, y - 8);
  await page.mouse.move(x, y, { steps: 4 }); // the pointer moves first, as a hand or a mouse would
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
}

const cardsIn = (page: Page, column: number) =>
  page.evaluate((c) => (window as Win).__workspace.state.boards[0].columns[c].cards.map((k: any) => k.title), column);

test('manual flow: pick, drop, undo, Focus 25, reload, a timer rings', async ({ page }) => {
  const errors = await openWorkspace(page);
  const first = (await cardsIn(page, 0))[0];

  await tap(page, 'b1:card-0-0');
  expect(await page.evaluate(() => (window as Win).__notice?.text)).toContain('Holding');
  await tap(page, 'b1:col-2', 0, -0.4); // empty lower part of the Done column
  expect(await cardsIn(page, 2)).toContain(first);
  expect(await cardsIn(page, 0)).not.toContain(first);

  await tap(page, 'command:undo-button');
  expect(await cardsIn(page, 0)).toContain(first);

  const second = (await cardsIn(page, 0))[1];
  await tap(page, 'b1:card-0-1');
  await tap(page, 'b1:card-1-0'); // drop onto a card: it takes that card's place
  expect((await cardsIn(page, 1))[0]).toBe(second);

  await tap(page, 'command:focus-button');
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.map((t: any) => t.state))).toEqual(['running']);

  await page.waitForTimeout(600); // debounced save
  const before = await page.evaluate(() => JSON.stringify((window as Win).__workspace.state.boards));
  await page.reload();
  errors.push(...(await openWorkspace(page)));
  expect(await page.evaluate(() => JSON.stringify((window as Win).__workspace.state.boards))).toBe(before);
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.length)).toBe(1);

  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'start_timer', minutes: 0.1, label: 'Quick' }));
  await page.waitForFunction(() => ((window as Win).__timerAlerts ?? 0) >= 1, null, { timeout: 20_000 });
  const quick = await page.evaluate(() => (window as Win).__workspace.state.timers.find((t: any) => t.label === 'Quick')?.state);
  expect(quick).toBe('done');
  expect(errors).toEqual([]);
});
