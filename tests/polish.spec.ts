/**
 * The micro-interactions, in the emulated headset:
 *  - a card under a ray wears a soft rim that breathes slowly (never blinks, never goes out) and leaves with the ray;
 *    the eyes light it too, once they have rested on it for a second; with reduced motion it holds still;
 *  - a button gives way under a fingertip: back into its panel in proportion to the finger's nearness from 5 cm, then
 *    with the finger once touched (still one press), and back in its place when the finger leaves;
 *  - a pointer onto a new control ticks, faintly, from the control, never twice within 120 ms however fast it sweeps;
 *  - while Nova thinks, an orb breathes on the agent's card instead of a counter.
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, frames, lookAt, openWorkspace, tap, type Win } from './helpers.js';

/** Points a controller's ray from beside the hip at a named element, or away to its side (null). */
const aim = (page: Page, name: string | null, hand: 'left' | 'right' = 'right') =>
  page.evaluate(({ name, hand }) => {
    const w = (window as Win).__world;
    const V = w.camera.position.constructor;
    const Q = w.camera.quaternion.constructor;
    const controller = (window as Win).__xrDevice.controllers[hand];
    const side = hand === 'right' ? 1 : -1;
    const from = new V(0.18 * side, 1.3, -0.25);
    let target = new V(2 * side, 0.3, -0.5);
    if (name) {
      let el: any = null;
      w.scene.traverse((o: any) => {
        if (o.name === name) el = o;
      });
      if (!el) throw new Error(`no element ${name}`);
      el.updateWorldMatrix(true, false);
      target = new V().setFromMatrixPosition(el.matrixWorld);
    }
    const q = new Q().setFromUnitVectors(new V(0, 0, -1), target.sub(from).normalize());
    controller.position.set(from.x, from.y, from.z);
    controller.quaternion.set(q.x, q.y, q.z, q.w);
  }, { name, hand });

const rim = (page: Page) => page.evaluate(() => ({ ...(window as Win).__rim.state }) as { visible: boolean; key: string | null; by: string | null; opacity: number; width: number; height: number });

/** The rim's opacity every [everyMs] for [ms]. */
async function breaths(page: Page, ms: number, everyMs = 100): Promise<number[]> {
  const out: number[] = [];
  for (let t = 0; t < ms; t += everyMs) {
    out.push((await rim(page)).opacity);
    await page.waitForTimeout(everyMs);
  }
  return out;
}

/** The right controller's tip (or index fingertip) [d] metres in front of a named element, pointing into it. */
async function tipAt(page: Page, name: string, d: number): Promise<void> {
  await page.evaluate(
    async ({ name, d }) => {
      const w = (window as Win).__world;
      let el: any = null;
      w.scene.traverse((o: any) => {
        if (o.name === name) el = o;
      });
      const V = w.camera.position.constructor;
      const Q = w.camera.quaternion.constructor;
      const source = (window as Win).__xrDevice.controllers.right;
      const raf = () => new Promise(requestAnimationFrame);
      for (let i = 0; i < 3; i++) {
        el.updateWorldMatrix(true, false);
        const e = el.matrixWorld.elements;
        const n = new V(e[0], e[1], e[2]).cross(new V(e[4], e[5], e[6])).normalize();
        const q = new Q().setFromUnitVectors(new V(0, 0, -1), n.clone().negate());
        source.quaternion.set(q.x, q.y, q.z, q.w);
        await raf();
        await raf();
        const tip = w.player.indexTipSpaces.right.getWorldPosition(new V());
        const goal = new V().setFromMatrixPosition(el.matrixWorld).addScaledVector(n, d).sub(tip.sub(new V(source.position.x, source.position.y, source.position.z)));
        source.position.set(goal.x, goal.y, goal.z);
      }
      for (let i = 0; i < 3; i++) await raf();
    },
    { name, d },
  );
}

test('a card under a ray wears a slowly breathing rim; it leaves with the ray, and the eyes light it after a second', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await enterXR(page);
  await aim(page, null, 'left'); // the left ray rests on the board where the emulator starts it
  await aim(page, 'b1:card-0-1');
  await page.waitForFunction(() => (window as Win).__rim.state.key === 'card-0-1' && (window as Win).__rim.state.level === 1, null, { timeout: 3_000 });
  expect(await rim(page)).toMatchObject({ key: 'card-0-1', by: 'pointer' });
  // Round the card itself: its size, lifted with it (both read in the same frame, once the card has finished rising).
  await page.waitForTimeout(400);
  const { lit, card } = await page.evaluate(() => {
    let el: any = null;
    (window as Win).__world.scene.traverse((o: any) => {
      if (o.name === 'b1:card-0-1') el = o;
    });
    const e = el.matrixWorld.elements;
    return { lit: { ...(window as Win).__rim.state }, card: { width: Math.hypot(e[0], e[1], e[2]), height: Math.hypot(e[4], e[5], e[6]) } };
  });
  expect(lit.width).toBeCloseTo(card.width, 3);
  expect(lit.height).toBeCloseTo(card.height, 3);

  // It breathes: dimmer and brighter over a 2.6 s breath, smoothly, never out.
  const samples = await breaths(page, 2800);
  const peak = Math.max(...samples);
  expect(peak - Math.min(...samples)).toBeGreaterThan(0.25 * peak);
  expect(Math.min(...samples)).toBeGreaterThan(0.45 * peak);
  for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThan(0.12);

  // The ray moves off: the rim fades out.
  await aim(page, null);
  await page.waitForFunction(() => !(window as Win).__rim.state.visible, null, { timeout: 2_000 });

  // The eyes: nothing at first, the rim after a second's rest, and one faint tick from the card.
  const eyeTicks = await page.evaluate(() => (window as Win).__rim.state.eyeTicks as number);
  await lookAt(page, 'b1:card-0-2');
  await page.waitForTimeout(500);
  expect((await rim(page)).visible).toBe(false);
  await page.waitForFunction(() => (window as Win).__rim.state.visible && (window as Win).__rim.state.by === 'eyes', null, { timeout: 3_000 });
  expect((await rim(page)).key).toBe('card-0-2');
  expect(await page.evaluate(() => (window as Win).__rim.state.eyeTicks as number)).toBe(eyeTicks + 1); // other pointers may tick meanwhile

  // With reduced motion the rim holds still.
  await page.evaluate(() => (window as Win).__access.set('reducedMotion', true));
  await page.waitForFunction(() => (window as Win).__rim.state.level === 1, null, { timeout: 2_000 });
  const still = await breaths(page, 1500);
  expect(Math.max(...still) - Math.min(...still)).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test('a button gives way under a fingertip: in proportion from 5 cm, with the finger once touched, back when it leaves', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await enterXR(page);
  // Undo, with nothing to undo: pressing it moves nothing else (Focus 25 would re-anchor the space and glide it).
  const button = 'command:undo-button';
  /** How far the button is behind its row (along the panel's normal); the finger's distance; the poke's depth. */
  const measure = () =>
    page.evaluate((name) => {
      let el: any = null;
      (window as Win).__world.scene.traverse((o: any) => {
        if (o.name === name) el = o;
      });
      el.updateWorldMatrix(true, false);
      const e = el.matrixWorld.elements;
      const p = el.parent.matrixWorld.elements;
      const V = (window as Win).__world.camera.position.constructor;
      const n = new V(e[0], e[1], e[2]).cross(new V(e[4], e[5], e[6])).normalize();
      const behind = new V(p[12] - e[12], p[13] - e[13], p[14] - e[14]).dot(n) as number;
      const poke = (window as Win).__poke;
      return { behind, distance: poke.distances[1] as number, depth: poke.depths[1] as number, presses: poke.presses as number };
    }, button);
  await tipAt(page, button, 0.3);
  const rest = (await measure()).behind;
  const sunkNow = async () => {
    const m = await measure();
    return { ...m, sunk: m.behind - rest };
  };
  // What the poke promises: nothing at 5 cm, 2.5 mm on contact (6 mm), then with the finger, at most 12 mm.
  const expected = (d: number) => (d >= 0.05 ? 0 : d > 0.006 ? (0.0025 * (0.05 - d)) / 0.044 : Math.min(0.012, 0.0025 + 0.006 - d));

  let before = -1;
  for (const d of [0.045, 0.035, 0.025, 0.015, 0.009]) {
    await tipAt(page, button, d);
    const m = await sunkNow();
    expect(m.depth, JSON.stringify(m)).toBeCloseTo(expected(m.distance), 3.4); // within a quarter millimetre step
    expect(Math.abs(m.sunk - m.depth), JSON.stringify(m)).toBeLessThan(0.0003); // the button really moved that far
    expect(m.sunk).toBeGreaterThan(before); // nearer, deeper
    expect(m.presses).toBe(0);
    before = m.sunk;
  }
  // Touched and pushed through: it goes with the finger, as far as 12 mm, and it was one press.
  await tipAt(page, button, -0.004);
  const pushed = await sunkNow();
  expect(pushed.sunk).toBeGreaterThan(0.008);
  expect(pushed.sunk).toBeLessThanOrEqual(0.0121);
  expect(pushed.presses).toBe(1);
  // The finger leaves: back in its place within a fifth of a second.
  await tipAt(page, button, 0.3);
  await page.waitForTimeout(200);
  const back = await sunkNow();
  expect(Math.abs(back.sunk)).toBeLessThan(0.0002);
  expect(back.depth).toBe(0);
  expect(errors).toEqual([]);
});

test('a pointer onto a new control ticks faintly from it, never twice within 120 ms however fast it sweeps', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await openWorkspace(page, '?emulate');
  // A gesture lets the browser start audio: sound off and on again.
  await tap(page, 'command:sound-button');
  await tap(page, 'command:sound-button');
  await page.waitForFunction(() => (window as Win).__sound.running(), null, { timeout: 5_000 });
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await frames(page, 20);
  await aim(page, null);
  await frames(page, 10);
  const before = await page.evaluate(() => (window as Win).__sound.ticks());

  // A quick sweep across the board's six cards: a card a frame.
  const cards = ['b1:card-0-0', 'b1:card-0-1', 'b1:card-0-2', 'b1:card-1-0', 'b1:card-1-1', 'b1:card-2-0'];
  const started = await page.evaluate(() => performance.now());
  for (const card of cards) {
    await aim(page, card);
    await frames(page, 1);
  }
  const ended = await page.evaluate(() => performance.now());
  const after = await page.evaluate(() => (window as Win).__sound.ticks());
  const played = after.played - before.played;
  expect(played).toBeGreaterThanOrEqual(1);
  expect(played).toBeLessThanOrEqual(Math.ceil((ended - started) / 120) + 1);
  expect(after.held - before.held).toBeGreaterThan(0);
  const times: number[] = after.at.slice(-played);
  for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(119.9);

  // A moment later, onto another card: it ticks, from that card.
  await aim(page, null);
  await page.waitForTimeout(300);
  await aim(page, 'b1:card-0-1');
  await frames(page, 3);
  expect((await page.evaluate(() => (window as Win).__sound.ticks())).played).toBe(after.played + 1);
  const place = await page.evaluate(() => {
    let el: any = null;
    (window as Win).__world.scene.traverse((o: any) => {
      if (o.name === 'b1:card-0-1') el = o;
    });
    const at = (window as Win).__sound.lastPlace('tick');
    const e = el.matrixWorld.elements;
    return Math.hypot(at.x - e[12], at.y - e[13], at.z - e[14]);
  });
  expect(place).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});

test('while Nova thinks, an orb breathes on the agent card instead of a counter, and goes when the answer comes', async ({ page }) => {
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/agent/plan', async (route) => {
    await new Promise((r) => setTimeout(r, 1600)); // Nova's usual second and a half
    await route.fulfill({ json: { ok: true, summary: 'A short break.', steps: [{ op: { op: 'start_timer', minutes: 5, label: 'Break' }, why: 'Rest' }], source: 'us.amazon.nova-2-lite-v1:0' } });
  });
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await openWorkspace(page);
  await page.evaluate(() => (window as Win).__voice.say('give me a short break'));
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'thinking');
  const shown = () =>
    page.evaluate(() => {
      let el: any = null;
      (window as Win).__world.scene.traverse((o: any) => {
        if (o.name === 'agent:plan-thinking') el = o;
      });
      return el.isVisible.value as boolean;
    });
  expect(await shown()).toBe(true);
  const orbs: { halo: number; core: number; glow: number }[] = [];
  for (let i = 0; i < 12; i++) {
    orbs.push(await page.evaluate(() => ({ ...(window as Win).__agent.orb })));
    await page.waitForTimeout(90);
  }
  const span = (k: 'halo' | 'core' | 'glow') => Math.max(...orbs.map((o) => o[k])) - Math.min(...orbs.map((o) => o[k]));
  expect(span('core')).toBeGreaterThan(0.08); // the core breathes
  expect(span('halo')).toBeGreaterThan(0.3); // the ring of light rises
  expect(span('glow')).toBeGreaterThan(0.15); // and fades
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  await frames(page, 3);
  expect(await shown()).toBe(false);
  expect(errors).toEqual([]);
});
