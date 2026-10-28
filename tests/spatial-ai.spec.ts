/**
 * Spatial AI and direct interaction, in the emulated headset:
 *  - the agent knows what "this" is: the card the eyes rested on for a second, tested five times a second (not every
 *    frame), sent as ids only with words that point, never otherwise; the command panel never becomes "this";
 *  - a fingertip (or a controller's tip) pushes what it touches: from 5 cm the control lights and a ring shows where
 *    the finger will land; touching presses at once, once, however slowly; a finger coming from behind presses nothing;
 *  - every cue sounds from its place: the click from the button pushed, the glide's breath of air from the panel,
 *    following it as it moves and staying put in the room as the head turns.
 */
import { expect, test, type Page } from '@playwright/test';
import { enterXR, frames, lookAt, openWorkspace, settled, tap, turnHead, type Win } from './helpers.js';

const sessions = (page: Page) => page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));

/** Where a named element is in the room. */
const placeOf = (page: Page, name: string) =>
  page.evaluate((name) => {
    const w = (window as Win).__world;
    let el: any = null;
    w.scene.traverse((o: any) => {
      if (o.name === name) el = o;
    });
    if (!el) throw new Error(`no element ${name}`);
    el.updateWorldMatrix(true, false);
    const p = new (w.camera.position.constructor)().setFromMatrixPosition(el.matrixWorld);
    return { x: p.x as number, y: p.y as number, z: p.z as number };
  }, name);

/**
 * Puts the right controller's tip (or, with hands, the index fingertip) [d] metres in front of a named element's
 * centre, pointing into it. The tip's offset from the input's own pose is measured, not assumed.
 */
async function tipAt(page: Page, name: string, d: number, input: 'controllers' | 'hands' = 'controllers'): Promise<void> {
  await page.evaluate(
    async ({ name, d, input }) => {
      const w = (window as Win).__world;
      const device = (window as Win).__xrDevice;
      let el: any = null;
      w.scene.traverse((o: any) => {
        if (o.name === name) el = o;
      });
      if (!el) throw new Error(`no element ${name}`);
      const V = w.camera.position.constructor;
      const Q = w.camera.quaternion.constructor;
      const source = device[input].right;
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
        const offset = tip.sub(new V(source.position.x, source.position.y, source.position.z));
        const goal = new V().setFromMatrixPosition(el.matrixWorld).addScaledVector(n, d).sub(offset);
        source.position.set(goal.x, goal.y, goal.z);
      }
      for (let i = 0; i < 3; i++) await raf();
    },
    { name, d, input },
  );
}

const poke = (page: Page) =>
  page.evaluate(() => {
    const p = (window as Win).__poke;
    return { presses: p.presses as number, keys: [...p.keys] as (string | null)[], distances: [...p.distances] as number[] };
  });
const ring = (page: Page) =>
  page.evaluate(() => {
    let r: any = null;
    (window as Win).__world.scene.traverse((o: any) => {
      if (o.name === 'poke-ring-right') r = o;
    });
    return { visible: r.visible as boolean, size: r.scale.x as number };
  });

test('the agent knows what "this" is: the card the eyes rest on for a second, sent only with words that point', async ({ page }) => {
  const bodies: any[] = [];
  await sessions(page);
  await page.route('**/api/agent/plan', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, summary: 'I can move it to Done.', steps: [], source: 'us.amazon.nova-2-lite-v1:0', latencyMs: 700, attempts: 1 } });
  });
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await enterXR(page);
  const card = await page.evaluate(() => (window as Win).__workspace.state.boards.find((b: any) => b.id === 'b1').columns[0].cards[1]);

  await lookAt(page, 'b1:card-0-1');
  expect((await page.evaluate(() => (window as Win).__attention.state.focus))?.card, 'not before a second').not.toBe(card.id);
  // Tested about five times a second, not every frame.
  const before = await page.evaluate(() => (window as Win).__attention.state.tests);
  await page.waitForTimeout(1000);
  const tests = (await page.evaluate(() => (window as Win).__attention.state.tests)) - before;
  expect(tests).toBeGreaterThanOrEqual(3);
  expect(tests).toBeLessThanOrEqual(7);
  await page.waitForFunction((id) => (window as Win).__attention.state.focus?.card === id, card.id, { timeout: 3_000 });
  expect(await page.evaluate(() => (window as Win).__attention.state.focus)).toEqual({ board: 'b1', card: card.id, title: card.title });

  // The command panel is not something to call "this": a second on its Focus button changes nothing.
  await lookAt(page, 'command:focus-button');
  await page.waitForTimeout(1400);
  expect((await page.evaluate(() => (window as Win).__attention.state.focus)).card).toBe(card.id);

  // "Move this to done": the request carries the card, by id, and nothing else about it.
  await page.evaluate(() => (window as Win).__voice.say('move this to done'));
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ intent: 'companion', text: 'move this to done', attention: { board: 'b1', card: card.id } });
  expect(Object.keys(bodies[0].attention).sort()).toEqual(['board', 'card']);
  await page.waitForFunction(() => (window as Win).__agent.state.phase !== 'thinking');

  // A request that names its own work carries nothing.
  await page.evaluate(() => (window as Win).__voice.say('plan my day: write the report'));
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].attention).toBeUndefined();
  await page.waitForFunction(() => (window as Win).__agent.state.phase !== 'thinking');

  // "Help me start this": the card looked at becomes the task, so even the built-in planner knows which.
  await page.evaluate(() => (window as Win).__voice.say('help me start this'));
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[2]).toMatchObject({ intent: 'first_step', text: card.title });

  // A card that is gone is no longer "this".
  await page.evaluate((id) => (window as Win).__workspace.dispatch({ op: 'remove_card', card: id }), card.id);
  expect(await page.evaluate(() => (window as Win).__attention.lookedAt((window as Win).__workspace.state))).toBeNull();
  expect(errors).toEqual([]);
});

test('poke: from 5 cm the control lights and a ring closes in; touching presses once, at once, however slowly', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await enterXR(page);
  const timers = () => page.evaluate(() => (window as Win).__workspace.state.timers.length as number);

  await tipAt(page, 'command:focus-button', 0.04);
  let state = await poke(page);
  expect(state.keys[1]).toBe('focus');
  expect(state.distances[1]).toBeCloseTo(0.04, 2);
  const far = await ring(page);
  expect(far.visible).toBe(true);
  await tipAt(page, 'command:focus-button', 0.012);
  const near = await ring(page);
  expect(near.size).toBeLessThan(far.size); // the ring closes in as the finger nears
  expect((await poke(page)).presses).toBe(0); // close is not touching
  expect(await timers()).toBe(0);

  await tipAt(page, 'command:focus-button', 0);
  expect((await poke(page)).presses).toBe(1);
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.length === 1); // Focus 25 started
  // A slow, resting press is still one press (IWSDK's own poke would have dropped it after 800 ms).
  await page.waitForTimeout(1500);
  expect((await poke(page)).presses).toBe(1);
  // Drawing back a centimetre is not enough to press again; two are.
  await tipAt(page, 'command:focus-button', 0.012);
  await tipAt(page, 'command:focus-button', 0);
  expect((await poke(page)).presses).toBe(1);
  await tipAt(page, 'command:focus-button', 0.03);
  await tipAt(page, 'command:focus-button', 0);
  expect((await poke(page)).presses).toBe(2);

  // A finger that comes from behind the panel presses nothing.
  await tipAt(page, 'command:focus-button', 0.2);
  await tipAt(page, 'command:focus-button', -0.025);
  await tipAt(page, 'command:focus-button', 0);
  expect((await poke(page)).presses).toBe(2);
  // Away from the panel: nothing lit, no ring.
  await tipAt(page, 'command:focus-button', 0.2);
  state = await poke(page);
  expect(state.keys[1]).toBeNull();
  expect((await ring(page)).visible).toBe(false);
  expect(errors).toEqual([]);
});

test('poke with a tracked hand: the index fingertip pushes a card, slowly, and picks it up', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await enterXR(page);
  await page.evaluate(() => ((window as Win).__xrDevice.primaryInputMode = 'hand'));
  await frames(page, 10);
  // A slow approach: from 5 cm to the surface over about a second and a half.
  for (const d of [0.05, 0.04, 0.03, 0.022, 0.016, 0.011, 0.007, 0.004, 0]) {
    await tipAt(page, 'b1:card-0-0', d, 'hands');
    await page.waitForTimeout(120);
  }
  const state = await poke(page);
  expect(state.keys[1]).toBe('card-0-0');
  expect(state.presses).toBe(1);
  await page.waitForFunction(() => (window as Win).__notice?.text?.startsWith('Holding'), null, { timeout: 3_000 });
  await page.waitForTimeout(1200); // resting on it: still the one press
  expect((await poke(page)).presses).toBe(1);
  expect(errors).toEqual([]);
});

test("a quick tap is one press, with a hand or a controller (IWSDK's own touch pointer would press again on release)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await enterXR(page);
  // A controller's tip taps Focus 25 and is gone again within a tenth of a second: one timer.
  await tipAt(page, 'command:focus-button', 0.03);
  await tipAt(page, 'command:focus-button', 0);
  await tipAt(page, 'command:focus-button', 0.03);
  await tipAt(page, 'command:focus-button', 0.2);
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => (window as Win).__workspace.state.timers.length)).toBe(1);
  // A hand taps a card quickly: it is picked up, and not put straight back.
  await page.evaluate(() => ((window as Win).__xrDevice.primaryInputMode = 'hand'));
  await frames(page, 10);
  await tipAt(page, 'b1:card-0-0', 0.03, 'hands');
  await tipAt(page, 'b1:card-0-0', 0, 'hands');
  await tipAt(page, 'b1:card-0-0', 0.03, 'hands');
  await tipAt(page, 'b1:card-0-0', 0.2, 'hands');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => (window as Win).__notice?.text ?? '')).toMatch(/^Holding/);
  expect((await poke(page)).presses).toBe(2);
  expect(errors).toEqual([]);
});

test('3D sound: the click comes from the button pushed; a glide breathes from its panel, following it as the head turns', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
  const errors = await openWorkspace(page, '?emulate');
  // A gesture lets the browser start audio: sound off and on again.
  await tap(page, 'command:sound-button');
  await tap(page, 'command:sound-button');
  await page.waitForFunction(() => (window as Win).__sound.running(), null, { timeout: 5_000 });
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await frames(page, 20);

  // The click: pushed with a fingertip, it sounds from the button itself.
  await tipAt(page, 'command:focus-button', 0.03);
  const button = await placeOf(page, 'command:focus-button'); // where it is when pushed (Focus 25 then re-anchors the space)
  await tipAt(page, 'command:focus-button', 0);
  expect((await poke(page)).presses).toBe(1);
  const click = await page.evaluate(() => (window as Win).__sound.lastPlace('tap'));
  expect(click, 'the click sounds from a place').toBeTruthy();
  expect(Math.hypot(click.x - button.x, click.y - button.y, click.z - button.z)).toBeLessThan(0.002);
  await tipAt(page, 'command:focus-button', 0.3);
  await settled(page);
  await page.waitForTimeout(600); // the click and anything it set off have died away

  // The glide: the space moves further away (as "a bit further" would), and each board breathes from where it is.
  const sample = () =>
    page.evaluate(() => {
      const w = (window as Win).__world;
      const voice = (window as Win).__sound.voices().find((v: any) => v.kind === 'whoosh' && v.follows === 'b1:pinned');
      let board: any = null;
      w.scene.traverse((o: any) => {
        if (o.name === 'b1:pinned') board = o;
      });
      const p = board.getWorldPosition(new (w.camera.position.constructor)());
      return { voice, board: { x: p.x as number, y: p.y as number, z: p.z as number }, gliding: (window as Win).__glide.active() as number };
    });
  await page.evaluate(() => {
    const a = (window as Win).__workspace.state.anchor;
    (window as Win).__workspace.dispatch({ op: 'set_comfort', reach: 1.4 }, { label: 'sound test', viewer: { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: 0 } });
  });
  await frames(page, 3);
  const first = await sample();
  expect(first.gliding).toBeGreaterThan(0);
  expect(first.voice, 'a whoosh follows the board').toBeTruthy();
  await page.waitForTimeout(150);
  const second = await sample();
  expect(second.voice).toBeTruthy();
  const gap = (v: any, b: { x: number; y: number; z: number }) => Math.hypot(v.at.x - b.x, v.at.y - b.y, v.at.z - b.z);
  expect(gap(first.voice, first.board)).toBeLessThan(0.03); // where the board is, give or take a frame of its glide
  expect(gap(second.voice, second.board)).toBeLessThan(0.03);
  expect(Math.hypot(second.voice.at.x - first.voice.at.x, second.voice.at.y - first.voice.at.y, second.voice.at.z - first.voice.at.z)).toBeGreaterThan(0.02); // it moved with the board
  // In front of the ears now; turn the head a quarter to the left and the same sound is on the right.
  expect(second.voice.ears.z).toBeLessThan(0);
  await turnHead(page, 90);
  const turned = await sample();
  expect(turned.voice, 'still sounding').toBeTruthy();
  expect(turned.voice.ears.x).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});
