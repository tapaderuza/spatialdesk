/**
 * Edge cases the other specs do not reach, in the IWER Quest 3 emulator:
 *  - a headset that grants none of the optional WebXR capabilities, in VR and in the room;
 *  - an answer from the AI that arrives after the app has stopped waiting;
 *  - a pinch that lands on nothing, and one that slides off a control before it opens;
 *  - eyes that sweep across the boards faster than anything can be selected;
 *  - the network going away in the middle of a session, and coming back.
 * Emulator results: they show the app's logic, not how a physical headset behaves.
 */
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { enterXR, frames, lookAt, openWorkspace, pressXR, settled, tap, type Win } from './helpers.js';

const MANUAL = 'Network issue. Switched to manual mode.';
const SESSION = 'test-session-0000000000';
const PLAN = {
  ok: true,
  summary: 'One more card for today.',
  steps: [{ op: { op: 'add_card', board: 'b1', title: 'From the agent' }, why: 'You asked for it' }],
  source: 'us.amazon.nova-2-lite-v1:0',
  latencyMs: 900,
  attempts: 1,
};

const sessions = (page: Page) => page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: SESSION, protocol: 1 } }));
const boards = (page: Page) => page.evaluate(() => JSON.stringify((window as Win).__workspace.state.boards));
const timers = (page: Page) => page.evaluate(() => (window as Win).__workspace.state.timers.length as number);
const phase = (page: Page) => page.evaluate(() => (window as Win).__agent.state.phase as string);
const noticeText = (page: Page) => page.evaluate(() => (window as Win).__notice?.text as string | undefined);
const cardsIn = (page: Page, column: number) =>
  page.evaluate((c) => (window as Win).__workspace.state.boards[0].columns[c].cards.map((k: any) => k.title) as string[], column);
const allCards = (page: Page) =>
  page.evaluate(() => (window as Win).__workspace.state.boards.flatMap((b: any) => b.columns.flatMap((c: any) => c.cards.map((k: any) => k.id))) as string[]);
const onboarded = (page: Page) => page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));

/** Everything IWSDK can ask for beyond a place to stand: a headset here grants none of it. */
const CAPABILITIES = ['hand-tracking', 'anchors', 'plane-detection', 'mesh-detection', 'depth-sensing', 'hit-test', 'gaze-tracking', 'eye-tracking', 'layers', 'bounded-floor', 'unbounded'];

test('hardware tolerance: nothing is required, and a headset that grants no optional capability still runs, in VR and in the room', async ({ page }) => {
  await onboarded(page);
  const errors = await openWorkspace(page, '?emulate&room=office_small');
  await page.evaluate((withheld) => {
    const xr = navigator.xr as any;
    const real = xr.requestSession.bind(xr);
    const win = window as Win;
    win.__asked = [];
    xr.requestSession = (mode: string, init: any = {}) => {
      win.__asked.push({ mode, required: [...(init.requiredFeatures ?? [])], optional: [...(init.optionalFeatures ?? [])] });
      return real(mode, { ...init, requiredFeatures: [], optionalFeatures: (init.optionalFeatures ?? []).filter((f: string) => !withheld.includes(f)) });
    };
  }, CAPABILITIES);
  const granted = () => page.evaluate(() => [...((window as Win).__world.session.enabledFeatures ?? [])] as string[]);

  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await frames(page, 20);
  for (const capability of CAPABILITIES) expect(await granted(), 'VR, withheld').not.toContain(capability);
  await pressXR(page, 'command:focus-button'); // the controller still works everything
  expect(await timers(page)).toBe(1);

  await page.evaluate(() => (window as Win).__world.session.end());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'non-immersive', null, { timeout: 15_000 });
  await frames(page, 10);
  await tap(page, 'command:room-button');
  await page.waitForFunction(() => (window as Win).__room.state.inRoom, null, { timeout: 30_000 });
  for (const capability of CAPABILITIES) expect(await granted(), 'room, withheld').not.toContain(capability);

  // No planes to fit to: one plain line, and no board moves.
  const before = await boards(page);
  await page.evaluate(() => (window as Win).__voice.say('fit room'));
  await page.waitForFunction(() => (window as Win).__notice?.text?.includes("can't see your desk or walls"), null, { timeout: 8_000 });
  expect(await boards(page)).toBe(before);

  const asked = await page.evaluate(() => (window as Win).__asked as { mode: string; required: string[]; optional: string[] }[]);
  expect(asked.map((a) => a.mode)).toEqual(['immersive-vr', 'immersive-ar']);
  for (const request of asked) expect(request.required, `${request.mode} requires nothing`).toEqual([]);
  expect(errors).toEqual([]);
});

test('an answer later than the 7 s limit is dropped: one calm line, nothing changes, and a second request while waiting is not sent', async ({ page }) => {
  test.setTimeout(90_000);
  await sessions(page);
  let calls = 0;
  await page.route('**/api/agent/plan', async (route) => {
    calls++;
    if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 10_000)); // Bedrock takes 10 s
    await route.fulfill({ json: PLAN }).catch(() => {}); // the app may have hung up already
  });
  const errors = await openWorkspace(page);
  const before = await boards(page);

  const pressed = Date.now();
  await tap(page, 'command:plan-button');
  expect(await phase(page)).toBe('thinking');
  await page.evaluate(() => (window as Win).__voice.say('plan my day'));
  await page.waitForTimeout(500);
  expect(calls, 'one request at a time').toBe(1);

  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'idle', null, { timeout: 15_000 });
  expect(Date.now() - pressed).toBeGreaterThan(6_500);
  expect(Date.now() - pressed).toBeLessThan(9_500); // gave up before the answer came
  expect(await noticeText(page)).toBe(MANUAL);

  await page.waitForTimeout(Math.max(0, 11_500 - (Date.now() - pressed))); // past the moment the answer arrives
  expect(await phase(page), 'the late answer opens nothing').toBe('idle');
  expect(await boards(page), 'and changes nothing').toBe(before);

  await tap(page, 'command:plan-button'); // the AI is back: a new request gets its own answer, still only a proposal
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  expect(calls).toBe(2);
  expect(await boards(page), 'nothing changes until it is applied').toBe(before);
  expect(errors).toEqual([]);
});

/**
 * Points the right hand's ray at a named element, or with null at the floor, where there is nothing to press. A hand's
 * ray does not start at the hand or leave along its -Z: where it goes is measured from the ray itself, not assumed.
 */
async function aimHand(page: Page, name: string | null): Promise<void> {
  await page.evaluate(
    async (name) => {
      const w = (window as Win).__world;
      const hand = (window as Win).__xrDevice.hands.right;
      const raf = () => new Promise(requestAnimationFrame);
      hand.position.set(0.18, 1.3, -0.25);
      if (name === null) {
        hand.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
        return;
      }
      let el: any = null;
      w.scene.traverse((o: any) => {
        if (o.name === name) el = o;
      });
      if (!el) throw new Error(`no element ${name}`);
      const V = w.camera.position.constructor;
      const Q = w.camera.quaternion.constructor;
      const ray = w.player.raySpaces.right;
      for (let i = 0; i < 6; i++) {
        await raf();
        await raf();
        el.updateWorldMatrix(true, false);
        ray.updateWorldMatrix(true, false);
        const handNow = new Q(hand.quaternion.x, hand.quaternion.y, hand.quaternion.z, hand.quaternion.w);
        const offset = handNow.clone().invert().multiply(ray.getWorldQuaternion(new Q()));
        const dir = new V().setFromMatrixPosition(el.matrixWorld).sub(ray.getWorldPosition(new V())).normalize();
        const next = new Q().setFromUnitVectors(new V(0, 0, -1), dir).multiply(offset.invert());
        hand.quaternion.set(next.x, next.y, next.z, next.w);
      }
    },
    name,
  );
  await frames(page, 15);
}
const closeHand = async (page: Page) => {
  await page.evaluate(() => (window as Win).__xrDevice.hands.right.updatePinchValue(1));
  await frames(page, 12);
};
const openHand = async (page: Page) => {
  await page.evaluate(() => (window as Win).__xrDevice.hands.right.updatePinchValue(0));
  await frames(page, 12);
};

test('a pinch on nothing does nothing; a pinch that slides off a control presses nothing; a held card survives a pinch on nothing', async ({ page }) => {
  await onboarded(page);
  const errors = await enterXR(page);
  await page.evaluate(() => ((window as Win).__xrDevice.primaryInputMode = 'hand'));
  await frames(page, 15);
  const before = await boards(page);

  await aimHand(page, null);
  await closeHand(page);
  await openHand(page);
  expect(await boards(page), 'pinching at the floor changes nothing').toBe(before);
  expect(await timers(page)).toBe(0);

  // Closed on Focus 25, opened after the ray has left it: changing one's mind costs nothing.
  await aimHand(page, 'command:focus-button');
  await closeHand(page);
  await aimHand(page, null);
  await openHand(page);
  expect(await timers(page), 'a press that slides off is cancelled').toBe(0);

  // The same pinch kept on it does press: the two above were not silent for some other reason. The first pinch after a
  // cancel is lost in the pointer's state (not the app's), so the second is the one that must work.
  await aimHand(page, 'command:focus-button');
  await closeHand(page);
  await openHand(page);
  if ((await timers(page)) === 0) {
    await closeHand(page);
    await openHand(page);
  }
  expect(await timers(page)).toBe(1);
  await settled(page); // Focus 25 moves the other boards aside

  const cards = (await allCards(page)).sort();
  await aimHand(page, 'b1:card-0-0');
  await closeHand(page);
  await openHand(page);
  expect(await noticeText(page)).toContain('Holding');
  await aimHand(page, null);
  await closeHand(page);
  await openHand(page);
  expect((await allCards(page)).sort(), 'the held card is neither lost nor copied').toEqual(cards);
  expect(errors).toEqual([]);
});

test('eyes that sweep across the boards select nothing; a real rest is what counts, and later glances do not take it away', async ({ page }) => {
  test.setTimeout(60_000);
  await onboarded(page);
  const errors = await enterXR(page, '&handsfree');
  const before = await boards(page);
  const focusCard = () => page.evaluate(() => (window as Win).__attention.state.focus?.card as string | undefined);
  const presses = () => page.evaluate(() => (window as Win).__gaze.presses as number);
  const sweep = async (ms: number) => {
    const targets = ['b1:card-0-0', 'b1:card-0-1', 'command:focus-button', 'b1:card-0-2', 'command:undo-button'];
    for (const started = Date.now(); Date.now() - started < ms; ) {
      for (const target of targets) {
        await lookAt(page, target);
        await page.waitForTimeout(220); // well under the one-second dwell, in every target
      }
    }
  };

  await sweep(4_000);
  expect(await presses(), 'nothing pressed').toBe(0);
  expect(await focusCard(), 'nothing became "this"').toBeUndefined();
  expect(await timers(page)).toBe(0);
  expect(await boards(page)).toBe(before);

  const rested = await page.evaluate(() => (window as Win).__workspace.state.boards.find((b: any) => b.id === 'b1').columns[0].cards[1].id as string);
  await lookAt(page, 'b1:card-0-1');
  await page.waitForFunction((id) => (window as Win).__attention.state.focus?.card === id, rested, { timeout: 1_500 }); // a card waits 1.6 s to be pressed
  await lookAt(page, 'b1:title');

  await sweep(2_000);
  expect(await focusCard(), 'glances do not replace what the eyes rested on').toBe(rested);
  expect(await presses()).toBe(0);
  expect(errors).toEqual([]);
});

test('the network goes in the middle of a session: one calm line, the work carries on, re-entering needs no network, and it recovers by itself', async ({ page, context }) => {
  test.setTimeout(120_000);
  await sessions(page);
  await onboarded(page);
  let offline = false;
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket('**/ws?*', (ws) => {
    socket = ws;
    if (offline) return void ws.close({ code: 1011 }); // no way through: the link's next attempt fails too
    ws.onMessage(() => {});
    ws.send(JSON.stringify({ type: 'hello', sessionId: SESSION, serverTimeMs: Date.now(), protocol: 1 }));
  });
  const errors = await enterXR(page);
  await page.waitForFunction(() => (window as Win).__link?.kind === 'online', null, { timeout: 30_000 });

  offline = true;
  await context.setOffline(true);
  await (socket as WebSocketRoute | null)?.close({ code: 1011 });
  await page.waitForFunction(() => (window as Win).__link?.kind !== 'online', null, { timeout: 10_000 });

  // The AI cannot be reached: the wait ends and it says so once, calmly.
  const failures: (string | undefined)[] = [];
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/agent/plan')) failures.push(request.failure()?.errorText);
  });
  const pressed = Date.now();
  await pressXR(page, 'command:plan-button');
  await page.waitForFunction((text) => (window as Win).__notice?.text === text, MANUAL, { timeout: 12_000 });
  expect(Date.now() - pressed, 'within the 7 s limit (and the press itself)').toBeLessThan(10_000);
  expect(failures, 'because the network really was gone').toEqual(['net::ERR_INTERNET_DISCONNECTED']);
  expect(await phase(page)).toBe('idle');
  expect((await page.evaluate(() => (window as Win).__notice)).error, 'not an alarm').toBe(false);

  // The hands do not need it.
  const moved = (await cardsIn(page, 0))[0];
  await pressXR(page, 'b1:card-0-0');
  expect(await noticeText(page)).toContain('Holding');
  await pressXR(page, 'b1:col-2');
  await expect.poll(() => cardsIn(page, 2)).toContain(moved);
  await pressXR(page, 'command:focus-button');
  expect(await timers(page)).toBe(1);

  // Out to the headset's menu and back, as turning the Wi-Fi off may need: entering again asks nothing of the network.
  await page.evaluate(() => (window as Win).__world.session.end());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'non-immersive', null, { timeout: 15_000 });
  await page.evaluate(() => (window as Win).__world.launchXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await frames(page, 20);
  expect(await cardsIn(page, 2)).toContain(moved);

  // Back online: nobody has to do anything.
  offline = false;
  await context.setOffline(false);
  await page.route('**/api/agent/plan', (route) => route.fulfill({ json: PLAN }));
  await page.waitForFunction(() => (window as Win).__link?.kind === 'online', null, { timeout: 45_000 });
  await pressXR(page, 'command:plan-button');
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });

  // What was done offline was saved.
  await page.waitForTimeout(600); // the debounced save
  errors.push(...(await openWorkspace(page, '?emulate')));
  expect(await cardsIn(page, 2)).toContain(moved);
  expect(errors).toEqual([]);
});
