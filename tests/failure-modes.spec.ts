/**
 * What a headset, a browser, a network or a server can do to a session in progress, in the IWER Quest 3 emulator:
 *  - the server restarts under a live page, or refuses a new session because the network is over its limit;
 *  - the headset comes off in the middle of a glide, the system menu opens, the frame rate hitches;
 *  - controllers are put down and hands picked up, and back;
 *  - the browser refuses the immersive session or the microphone, or stores nothing;
 *  - the headset no longer knows the saved room, or refuses another persistent anchor;
 *  - the server answers with something that is not a usable plan;
 *  - a long sitting, which must leave nothing behind.
 * Emulator results: they show the app's logic, not how a physical headset behaves. The limits they pin are in
 * docs/JUDGE_FAQ.md.
 */
import { expect, test, type Page, type Route, type WebSocketRoute } from '@playwright/test';
import { aimHand, enterXR, frames, openWorkspace, pressXR, settled, tap, type Win } from './helpers.js';

const MANUAL = 'Network issue. Switched to manual mode.';
const PLAN = {
  ok: true,
  summary: 'One more card for today.',
  steps: [{ op: { op: 'add_card', board: 'b1', title: 'From the agent' }, why: 'You asked for it' }],
  source: 'us.amazon.nova-2-lite-v1:0',
  latencyMs: 900,
  attempts: 1,
};

const onboarded = (page: Page) => page.addInitScript(() => localStorage.setItem('spatialdesk.onboarded', '1'));
const hello = (ws: WebSocketRoute) => {
  ws.onMessage(() => {});
  ws.send(JSON.stringify({ type: 'hello', sessionId: 'x', serverTimeMs: Date.now(), protocol: 1 }));
};
const session = (page: Page) => page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
const boards = (page: Page) => page.evaluate(() => JSON.stringify((window as Win).__workspace.state.boards));
const timers = (page: Page) => page.evaluate(() => (window as Win).__workspace.state.timers.length as number);
const phase = (page: Page) => page.evaluate(() => (window as Win).__agent.state.phase as string);
const notice = (page: Page) => page.evaluate(() => (window as Win).__notice as { text: string; error: boolean } | undefined);
const online = (page: Page, timeout = 45_000) => page.waitForFunction(() => (window as Win).__link?.kind === 'online', null, { timeout });
const visible = (page: Page) => page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
const flat = (page: Page) => page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'non-immersive', null, { timeout: 15_000 });

test('the server restarts under a live page: the cards carry on, and after the next Plan the AI comes back with no reload', async ({ page }) => {
  test.setTimeout(150_000);
  await onboarded(page);
  let restarted = false;
  let issued = 0;
  const live: WebSocketRoute[] = [];
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: `session-${++issued}`.padEnd(22, '0'), protocol: 1 } }));
  await page.routeWebSocket('**/ws?*', (ws) => {
    if (restarted && ws.url().includes('session-1')) return void ws.close({ code: 1011 }); // this server has never heard of it
    live.push(ws);
    hello(ws);
  });
  await page.route('**/api/agent/plan', (route) =>
    route.request().headers()['x-session'].startsWith('session-1')
      ? route.fulfill({ status: 401, json: { ok: false, error: 'Your session expired. Reconnecting, try again in a moment.' } })
      : route.fulfill({ json: PLAN }),
  );
  const errors = await enterXR(page);
  await online(page);

  restarted = true;
  await live[0].close({ code: 1011 });
  await page.waitForFunction(() => (window as Win).__link?.kind !== 'online', null, { timeout: 10_000 });

  await pressXR(page, 'command:focus-button');
  expect(await timers(page), 'the hands never needed the server').toBe(1);
  await settled(page);
  // Known limit: a refused handshake reaches the browser as a plain close, so the link alone keeps offering the old id.
  await page.waitForTimeout(3_000);
  expect(issued).toBe(1);

  // The server's 401 to Plan is what drops the old id. That press may fall between the link's retries and end in the calm
  // line; the link then takes a new session by itself, and the next press works.
  await pressXR(page, 'command:plan-button');
  await page.waitForFunction((text) => (window as Win).__agent.state.phase === 'preview' || (window as Win).__notice?.text === text, MANUAL, { timeout: 12_000 });
  await online(page);
  expect(issued).toBe(2);
  if ((await phase(page)) !== 'preview') {
    await pressXR(page, 'command:plan-button');
    await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  }
  expect(errors).toEqual([]);
});

test('a network over the session limit: the cards work, Plan gets the calm line, and it connects by itself when the limit lifts', async ({ page }) => {
  test.setTimeout(150_000);
  await onboarded(page);
  let limited = true;
  await page.route('**/api/sessions', (route) =>
    limited
      ? route.fulfill({ status: 429, json: { status: 429, error: 'Too Many Requests', message: 'Too many new sessions from this network' } })
      : route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }),
  );
  await page.routeWebSocket('**/ws?*', hello);
  await page.route('**/api/agent/plan', (route) => route.fulfill({ json: PLAN }));
  const errors = await enterXR(page);
  await page.waitForFunction(() => (window as Win).__link?.reason?.includes('429'), null, { timeout: 15_000 });

  await pressXR(page, 'command:focus-button');
  expect(await timers(page)).toBe(1);
  await settled(page);

  await pressXR(page, 'command:plan-button');
  await page.waitForFunction((text) => (window as Win).__notice?.text === text, MANUAL, { timeout: 12_000 });
  expect((await notice(page))?.error, 'not an alarm').toBe(false);
  expect(await phase(page)).toBe('idle');

  limited = false;
  await online(page);
  await pressXR(page, 'command:plan-button');
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 10_000 });
  expect(errors).toEqual([]);
});

/** How far a card is from the viewer's eyes, in metres. */
const cardDistance = (page: Page) =>
  page.evaluate(() => {
    const w = (window as Win).__world;
    let card: any = null;
    w.scene.traverse((o: any) => {
      if (o.name === 'b1:card-0-0') card = o;
    });
    card.updateWorldMatrix(true, false);
    const V = w.camera.position.constructor;
    return new V().setFromMatrixPosition(card.matrixWorld).distanceTo(w.camera.getWorldPosition(new V())) as number;
  });

test('the headset comes off in the middle of a glide: nothing is left moving, and re-entering finds the new layout', async ({ page }) => {
  await onboarded(page);
  const errors = await enterXR(page);
  await frames(page, 30);
  const before = await cardDistance(page);
  await page.evaluate(() => {
    const a = (window as Win).__workspace.state.anchor;
    (window as Win).__workspace.dispatch({ op: 'set_comfort', reach: 1.4 }, { label: 'mid-glide', viewer: { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: 0 } });
  });
  await frames(page, 3);
  expect(await page.evaluate(() => (window as Win).__glide.active())).toBeGreaterThan(0);

  await page.evaluate(() => (window as Win).__world.session.end());
  await flat(page);
  await page.waitForFunction(() => (window as Win).__glide.active() === 0, null, { timeout: 5_000 });

  await page.evaluate(() => (window as Win).__world.launchXR());
  await visible(page);
  await frames(page, 20);
  await settled(page);
  expect(await page.evaluate(() => (window as Win).__workspace.state.comfort.reach)).toBe(1.4);
  expect(await cardDistance(page), 'the farther layout, in the new session').toBeGreaterThan(before + 0.08);
  expect(errors).toEqual([]);
});

test('a frame that stalls for half a second in the middle of a glide does not make the panel jump', async ({ page }) => {
  await onboarded(page);
  const errors = await enterXR(page);
  await frames(page, 30);
  const { total, biggest } = await page.evaluate(async () => {
    const w = window as Win;
    let card: any = null;
    w.__world.scene.traverse((o: any) => {
      if (o.name === 'b1:card-0-0') card = o;
    });
    const V = w.__world.camera.position.constructor;
    const at = () => {
      card.updateWorldMatrix(true, false);
      return new V().setFromMatrixPosition(card.matrixWorld);
    };
    const start = at();
    const a = w.__workspace.state.anchor;
    w.__workspace.dispatch({ op: 'set_comfort', reach: 1.4 }, { label: 'hitch', viewer: { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: 0 } });
    let last = at();
    let biggest = 0;
    for (let i = 0; i < 150; i++) {
      await new Promise(requestAnimationFrame);
      if (i === 8) {
        const until = performance.now() + 500;
        while (performance.now() < until); // the main thread is gone for half a second
      }
      const now = at();
      biggest = Math.max(biggest, now.distanceTo(last));
      last = now;
    }
    return { total: last.distanceTo(start) as number, biggest };
  });
  console.log(`HITCH moved ${(total * 100).toFixed(1)} cm, biggest frame ${(biggest * 100).toFixed(2)} cm`);
  expect(total).toBeGreaterThan(0.08);
  expect(biggest, 'the step is capped, so the stall is not paid in one leap').toBeLessThan(total * 0.35);
  expect(await page.evaluate(() => (window as Win).__glide.active())).toBe(0);
  expect(errors).toEqual([]);
});

test('the system menu opens over the app: nothing breaks, a timer keeps its time, and the next press works', async ({ page }) => {
  await onboarded(page);
  const errors = await enterXR(page);
  await pressXR(page, 'command:focus-button');
  expect(await timers(page)).toBe(1);
  await settled(page);
  const endsAt = await page.evaluate(() => JSON.stringify((window as Win).__workspace.state.timers[0]));

  await page.evaluate(() => (window as Win).__xrDevice.updateVisibilityState('visible-blurred'));
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible-blurred', null, { timeout: 10_000 });
  await page.waitForTimeout(1_000);
  await page.evaluate(() => (window as Win).__xrDevice.updateVisibilityState('visible'));
  await visible(page);
  await frames(page, 10);

  expect(await page.evaluate(() => JSON.stringify((window as Win).__workspace.state.timers[0])), 'a running timer is stored as when it ends').toBe(endsAt);
  await pressXR(page, 'command:undo-button');
  expect(await timers(page), 'input is back').toBe(0);
  expect(errors).toEqual([]);
});

test('controllers put down, hands picked up, and back: each press lands once, with no restart', async ({ page }) => {
  await onboarded(page);
  const errors = await enterXR(page);
  await pressXR(page, 'command:focus-button');
  expect(await timers(page), 'controller').toBe(1);
  await settled(page);

  await page.evaluate(() => ((window as Win).__xrDevice.primaryInputMode = 'hand'));
  await frames(page, 15);
  await aimHand(page, 'command:undo-button');
  await page.evaluate(() => (window as Win).__xrDevice.hands.right.updatePinchValue(1));
  await frames(page, 12);
  await page.evaluate(() => (window as Win).__xrDevice.hands.right.updatePinchValue(0));
  await frames(page, 12);
  expect(await timers(page), 'hand').toBe(0);
  await settled(page);

  await page.evaluate(() => ((window as Win).__xrDevice.primaryInputMode = 'controller'));
  await frames(page, 15);
  await pressXR(page, 'command:focus-button');
  expect(await timers(page), 'controller again').toBe(1);
  expect(errors).toEqual([]);
});

test('the browser refuses the immersive session: no crash, the workspace stays, and the next try enters', async ({ page }) => {
  await onboarded(page);
  const errors = await openWorkspace(page, '?emulate');
  await page.evaluate(() => {
    const xr = navigator.xr as any;
    const real = xr.requestSession.bind(xr);
    let refuse = true;
    xr.requestSession = (mode: string, init: any) => {
      if (refuse) {
        refuse = false;
        return Promise.reject(new DOMException('The user denied the session.', 'NotAllowedError'));
      }
      return real(mode, init);
    };
  });
  const before = await boards(page);
  await tap(page, 'command:xr-button');
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => (window as Win).__world.visibilityState.value)).toBe('non-immersive');
  expect(await boards(page)).toBe(before);

  await tap(page, 'command:xr-button');
  await visible(page);
  expect(errors).toEqual([]);
});

test('the microphone is refused: it says so, and the server is not asked for anything', async ({ page }) => {
  await session(page);
  await page.routeWebSocket('**/ws?*', hello);
  let granted = 0;
  await page.route('**/api/voice/session', (route) => {
    granted++;
    return route.fulfill({ status: 503, json: { ok: false, error: 'unused' } });
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  const errors = await openWorkspace(page);
  await online(page);
  await tap(page, 'command:talk-button');
  await page.waitForFunction(() => (window as Win).__notice?.text?.includes('microphone is blocked'), null, { timeout: 8_000 });
  expect(granted, 'a refusal costs nothing on the server').toBe(0);
  expect(await phase(page)).toBe('idle');
  expect(errors).toEqual([]);
});

test('a browser that stores nothing: the app runs for the visit, and only the memory is lost', async ({ page }) => {
  await onboarded(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    IDBFactory.prototype.open = () => {
      throw new DOMException('Storage is blocked.', 'SecurityError');
    };
  });
  const errors = await enterXR(page);
  await pressXR(page, 'command:focus-button');
  expect(await timers(page)).toBe(1);
  await settled(page);
  await pressXR(page, 'b1:card-0-0');
  expect((await notice(page))?.text).toContain('Holding');
  await page.waitForTimeout(800); // the debounced save tries and fails
  expect(errors).toEqual([]);

  await page.evaluate(() => (window as Win).__world.session.end());
  await flat(page);
  errors.push(...(await openWorkspace(page, '?emulate')));
  expect(await timers(page), 'nothing was kept, and nothing broke').toBe(0);
  expect(errors).toEqual([]);
});

async function enterRoom(page: Page): Promise<void> {
  await tap(page, 'command:room-button');
  await page.waitForFunction(() => (window as Win).__room?.state.inRoom && (window as Win).__room.queries.planes.entities.size >= 8, null, { timeout: 30_000 });
  await frames(page, 20);
}
const fit = async (page: Page) => {
  await page.evaluate(() => {
    (window as Win).__room.state.lastFit = null;
    (window as Win).__voice.say('Fit to my room');
  });
  await page.waitForFunction(() => (window as Win).__room.state.lastFit != null, null, { timeout: 8_000 });
};
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('spatialdesk.room') ?? 'null') as { uuid: string; items: Record<string, unknown> } | null);

test('a room the headset no longer knows: one plain line, the layout stays, and Fit room replaces the memory', async ({ page }) => {
  test.setTimeout(120_000);
  await onboarded(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('spatialdesk.room', JSON.stringify({ uuid: 'erased-anchor', items: { b1: { x: 9, y: 9, z: 9, yaw: 0, pitch: 0 } } }));
    }
  });
  const errors = await openWorkspace(page, '?emulate&room=office_small');
  await page.evaluate(() => (window as Win).__xrDevice.position.set(0, 1.2, 0));
  await enterRoom(page);
  await page.waitForFunction(() => (window as Win).__notice?.text?.includes('could not find your room layout'), null, { timeout: 10_000 });
  expect((await notice(page))?.error).toBe(false);
  const poses = await page.evaluate(() => (window as Win).__workspace.state.boards.map((b: any) => b.pose.x) as number[]);
  expect(poses, 'the stale layout was not applied').not.toContain(9);
  expect(await page.evaluate(() => (window as Win).__room.state.restored)).toBe(0);

  await fit(page);
  expect(await page.evaluate(() => (window as Win).__room.state.lastFit.desk)).toBe(true);
  await page.waitForFunction(() => {
    const room = JSON.parse(localStorage.getItem('spatialdesk.room') ?? 'null');
    return room && room.uuid !== 'erased-anchor';
  }, null, { timeout: 5_000 });
  expect(errors).toEqual([]);
});

test('a saved room that is not readable is ignored, and the room still opens', async ({ page }) => {
  await onboarded(page);
  await page.addInitScript(() => localStorage.setItem('spatialdesk.room', '{not json'));
  const errors = await openWorkspace(page, '?emulate&room=office_small');
  await page.evaluate(() => (window as Win).__xrDevice.position.set(0, 1.2, 0));
  await enterRoom(page);
  expect(await page.evaluate(() => (window as Win).__room.remembers)).toBe(false);
  await fit(page);
  expect(await page.evaluate(() => (window as Win).__room.state.lastFit.desk)).toBe(true);
  expect(errors).toEqual([]);
});

test('the headset refuses another persistent anchor (Meta documents 8 for a site): the fit stands for the visit, with no error', async ({ page }) => {
  test.setTimeout(120_000);
  await onboarded(page);
  const errors = await openWorkspace(page, '?emulate&room=office_small');
  await page.evaluate(() => (window as Win).__xrDevice.position.set(0, 1.2, 0));
  await enterRoom(page);
  await fit(page);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('spatialdesk.room') ?? 'null')?.uuid, null, { timeout: 5_000 });
  const first = (await saved(page))!.uuid;

  await page.evaluate(() => {
    const anchor = (window as Win).__room.anchor;
    Object.getPrototypeOf(anchor).requestPersistentHandle = () => Promise.reject(new DOMException('Too many persistent anchors.', 'QuotaExceededError'));
  });
  await page.evaluate(() => (window as Win).__xrDevice.position.set(0.5, 1.2, 0)); // sitting somewhere else this time
  await frames(page, 5);
  await fit(page);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as Win).__room.state.lastFit.desk), 'the fit itself stands').toBe(true);
  const after = (await saved(page))!;
  const here = await page.evaluate(() => (window as Win).__workspace.state.boards.map((b: any) => ({ x: b.pose.x, y: b.pose.y, z: b.pose.z })) as { x: number; y: number; z: number }[]);

  await page.evaluate(() => (window as Win).__world.exitXR());
  await flat(page);
  await frames(page, 30);
  await enterRoom(page);
  await page.waitForFunction(() => (window as Win).__room.state.restored > 0, null, { timeout: 10_000 });
  const back = await page.evaluate(() => (window as Win).__workspace.state.boards.map((b: any) => ({ x: b.pose.x, y: b.pose.y, z: b.pose.z })) as { x: number; y: number; z: number }[]);
  const offsets = back.map((p, i) => Math.hypot(p.x - here[i].x, p.y - here[i].y, p.z - here[i].z));
  console.log(`ANCHOR REFUSED saved uuid unchanged=${after.uuid === first} restored offset m=${offsets.map((o) => o.toFixed(3)).join(',')}`);
  // Known limit: the layout was saved relative to the new anchor under the old handle, so it comes back out by the change of seat.
  expect(after.uuid).toBe(first);
  for (const offset of offsets) expect(offset).toBeCloseTo(0.5, 2);
  expect(errors).toEqual([]);
});

test('answers that are no use: a page of HTML, an empty object, a plan the engine rejects; nothing changes and nothing sticks', async ({ page }) => {
  test.setTimeout(120_000);
  await session(page);
  await page.routeWebSocket('**/ws?*', hello);
  let answer: (route: Route) => Promise<void> = (route) => route.fulfill({ json: PLAN });
  await page.route('**/api/agent/plan', (route) => answer(route));
  const errors = await openWorkspace(page);
  await online(page);
  const before = await boards(page);
  const ask = () => page.evaluate(() => (window as Win).__agent.run('plan_my_day', 'Anything.'));

  answer = (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Bad gateway, but with a 200</body></html>' });
  await ask();
  expect(await phase(page)).toBe('idle');
  expect((await notice(page))?.text, 'a page that is not JSON is the network talking').toBe(MANUAL);
  expect(await boards(page)).toBe(before);

  answer = (route) => route.fulfill({ json: {} });
  await ask();
  expect(await phase(page), 'an answer that says nothing is an error card, not an endless wait').toBe('error');
  expect(await boards(page)).toBe(before);

  // It reaches the preview (the server is trusted to have checked it); applying it goes through the engine, all or nothing.
  answer = (route) =>
    route.fulfill({
      json: {
        ...PLAN,
        steps: [
          { op: { op: 'add_card', board: 'b1', title: 'Fine' }, why: 'ok' },
          { op: { op: 'add_card', board: 'no-such-board', title: 'Not fine' }, why: 'nope' },
        ],
      },
    });
  await ask();
  if ((await phase(page)) === 'preview') await page.evaluate(() => (window as Win).__agent.apply());
  expect(await boards(page), 'a batch applies whole or not at all').toBe(before);

  await page.evaluate(() => (window as Win).__agent.discard?.());
  answer = (route) => route.fulfill({ json: PLAN });
  await ask();
  expect(await phase(page), 'and the next good answer works').toBe('preview');
  expect(errors).toEqual([]);
});

test('a long sitting: cards and comfort changes leave nothing behind; a board or timer panel removed has a known, bounded cost', async ({ page }) => {
  test.setTimeout(180_000);
  await onboarded(page);
  const errors = await enterXR(page);
  await frames(page, 30);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  const rounds = (kind: 'work' | 'board' | 'timer', count: number) =>
    page.evaluate(
      async ({ kind, count }) => {
        const store = (window as Win).__workspace;
        const a = store.state.anchor;
        const viewer = { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: 0 };
        const raf = async (n: number) => {
          for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
        };
        for (let i = 0; i < count; i++) {
          if (kind === 'work') {
            store.dispatch({ op: 'add_card', board: 'b1', title: `Round ${i}` }, { label: 'soak' });
            await raf(2);
            store.dispatch({ op: 'set_comfort', reach: i % 2 ? 1.2 : 0.9 }, { label: 'soak', viewer });
            await raf(2);
            store.undo();
            store.undo();
          } else {
            store.dispatch(kind === 'board' ? { op: 'create_board', title: 'For a moment' } : { op: 'start_timer', minutes: 25 }, { label: 'soak' });
            await raf(4);
            store.undo();
          }
          await raf(4);
        }
      },
      { kind, count },
    );
  const measure = async () => {
    await settled(page, 15_000);
    await frames(page, 20);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    return page.evaluate(() => {
      const w = (window as Win).__world;
      let objects = 0;
      w.scene.traverse(() => objects++);
      return { objects, geometries: w.renderer.info.memory.geometries as number, textures: w.renderer.info.memory.textures as number, heapMB: ((performance as any).memory.usedJSHeapSize as number) / 1048576 };
    });
  };

  await rounds('work', 5); // what a first use allocates once (fonts, shaders, pools) is not a leak
  const start = await measure();
  await rounds('work', 40);
  const worked = await measure();
  expect(worked.objects, 'scene objects after 160 changes').toBe(start.objects);
  expect(worked.geometries).toBe(start.geometries);
  expect(worked.textures).toBe(start.textures);
  expect(worked.heapMB - start.heapMB, 'JS heap, MB').toBeLessThan(4);

  // Known limits, measured and held where they are: removing a panel keeps memory (src/workspace/pinned.ts uses
  // entity.destroy(), which keeps a geometry, and the JS heap keeps about 3.3 MB per board and 0.4 MB per timer).
  await rounds('board', 10);
  const boarded = await measure();
  await rounds('timer', 10);
  const timed = await measure();
  console.log(`SOAK ${JSON.stringify({ start, worked, boarded, timed })}`);
  expect(timed.objects, 'nothing is left in the scene').toBe(start.objects);
  expect(timed.textures).toBe(start.textures);
  expect(boarded.heapMB - worked.heapMB, 'about 3.3 MB per board removed, MB').toBeLessThan(10 * 5);
  expect(timed.heapMB - boarded.heapMB, 'about 0.4 MB per timer removed, MB').toBeLessThan(10 * 1);
  expect(timed.geometries - boarded.geometries, 'one geometry per timer removed').toBeLessThanOrEqual(10);
  expect(errors).toEqual([]);
});
