/**
 * What a headset, a browser, a network or a server can do to a session in progress, in the IWER Quest 3 emulator:
 *  - the server restarts under a live page or the connection drops, or a new session is refused because the network is over its limit;
 *  - the headset comes off in the middle of a glide, the system menu opens, the frame rate hitches;
 *  - controllers are put down and hands picked up, and back;
 *  - the browser refuses the immersive session or the microphone, or stores nothing;
 *  - the headset no longer knows the saved room, holds old anchors, or refuses a persistent anchor;
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

/**
 * A server that sessions can be issued by, and that forgets them all when it restarts: the handshake is refused (which the
 * browser sees as a plain close) and the socket's path answers 401 over HTTP to an id it does not know, 400 to one it knows.
 */
async function restartableServer(page: Page) {
  const server = { up: true, issued: 0, known: new Set<string>(), live: [] as WebSocketRoute[], asked: [] as string[] };
  const idIn = (url: string) => new URL(url).searchParams.get('session') ?? '';
  await page.route('**/api/sessions', (route) => {
    if (!server.up) return route.fulfill({ status: 503, body: 'Service Unavailable' });
    const sessionId = `session-${++server.issued}`.padEnd(22, '0');
    server.known.add(sessionId);
    return route.fulfill({ json: { sessionId, protocol: 1 } });
  });
  await page.route('**/ws?*', (route) => route.fulfill({ status: !server.up ? 503 : server.known.has(idIn(route.request().url())) ? 400 : 401 }));
  await page.routeWebSocket('**/ws?*', (ws) => {
    if (!server.up || !server.known.has(idIn(ws.url()))) return void ws.close({ code: 1011 });
    server.live.push(ws);
    hello(ws);
  });
  await page.route('**/api/agent/plan', (route) => {
    const id = route.request().headers()['x-session'];
    server.asked.push(id);
    if (!server.up) return route.fulfill({ status: 503, body: 'Service Unavailable' });
    return server.known.has(id) ? route.fulfill({ json: PLAN }) : route.fulfill({ status: 401, json: { ok: false, error: 'Your session expired. Reconnecting, try again in a moment.' } });
  });
  return {
    server,
    /** The task is replaced: the sockets drop and every session is forgotten. */
    restart: async () => {
      server.known.clear();
      await Promise.all(server.live.splice(0).map((ws) => ws.close({ code: 1011 })));
    },
  };
}

test('the server restarts under a live page: the cards carry on, the link comes back by itself, and the next Plan just answers', async ({ page }) => {
  test.setTimeout(150_000);
  await onboarded(page);
  const { server, restart } = await restartableServer(page);
  const errors = await enterXR(page);
  await online(page);
  expect(server.issued).toBe(1);

  await restart();
  await pressXR(page, 'command:focus-button');
  expect(await timers(page), 'the hands never needed the server').toBe(1);
  await settled(page);

  await page.waitForFunction(() => (window as Win).__link?.kind === 'online' && !(window as Win).__link.sessionId.startsWith('session-1'), null, { timeout: 40_000 });
  expect(server.issued, 'with nobody pressing anything').toBe(2);

  server.asked.length = 0;
  await pressXR(page, 'command:plan-button');
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 7_000 });
  expect(server.asked.length, 'no refusal on the way').toBe(1);
  expect(errors).toEqual([]);
});

test('a press does not sit out the backoff: with the link deep in its wait when the server returns, the first Plan answers', async ({ page }) => {
  test.setTimeout(150_000);
  await onboarded(page);
  await page.addInitScript(() => {
    Math.random = () => 0.999; // the longest wait, every time
  });
  const { server, restart } = await restartableServer(page);
  const errors = await enterXR(page);
  await online(page);

  server.up = false;
  await restart();
  await page.waitForFunction(() => (window as Win).__link?.retryInMs > 12_000, null, { timeout: 60_000 });
  const waitLeft: number = await page.evaluate(() => (window as Win).__link.retryInMs);

  server.up = true;
  const pressed = Date.now();
  await pressXR(page, 'command:plan-button');
  await page.waitForFunction(() => (window as Win).__agent.state.phase === 'preview', null, { timeout: 7_000 });
  const took = Date.now() - pressed;
  console.log(`WOKEN plan answered in ${took} ms, with ${Math.round(waitLeft)} ms of backoff to run`);
  expect(took).toBeLessThan(5_000);
  expect(took).toBeLessThan(waitLeft);
  expect(errors).toEqual([]);
});

test('a connection lost while the server stays up keeps its session: no new one, so a helper pairing and the quotas carry on', async ({ page }) => {
  await onboarded(page);
  const { server } = await restartableServer(page);
  const errors = await enterXR(page);
  await online(page);
  const first: string = await page.evaluate(() => (window as Win).__link.sessionId);

  await server.live[0].close({ code: 1011 }); // the socket drops; the server still knows the id
  await page.waitForFunction(() => (window as Win).__link?.kind !== 'online', null, { timeout: 10_000 });
  await online(page);
  expect(await page.evaluate(() => (window as Win).__link.sessionId)).toBe(first);
  expect(server.issued).toBe(1);
  expect(errors).toEqual([]);
});

test('Talk meets a session the server has forgotten: it takes a fresh one and asks again, in the same press', async ({ page }) => {
  await onboarded(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.resolve(new MediaStream());
  });
  const { server } = await restartableServer(page);
  const seen: string[] = [];
  await page.route('**/api/voice/session', (route) => {
    const id = route.request().headers()['x-session'];
    seen.push(id);
    return server.known.has(id) ? route.fulfill({ json: { ok: false, error: 'Voice is resting.' } }) : route.fulfill({ status: 401, json: { ok: false, error: 'Your session expired. Reconnecting, try again in a moment.' } });
  });
  const errors = await openWorkspace(page);
  await online(page);

  server.known.clear(); // forgotten, with the socket still up: only the press can find out
  await tap(page, 'command:talk-button');
  await page.waitForFunction(() => (window as Win).__notice?.text?.includes('Voice is resting'), null, { timeout: 7_000 });
  expect(seen.length).toBe(2);
  expect(seen[0].startsWith('session-1')).toBe(true);
  expect(seen[1].startsWith('session-2')).toBe(true);
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

const boardPlaces = (page: Page) => page.evaluate(() => (window as Win).__workspace.state.boards.map((b: any) => ({ x: b.pose.x, y: b.pose.y, z: b.pose.z })) as { x: number; y: number; z: number }[]);
const persistentAnchors = (page: Page) => page.evaluate(() => (window as Win).__world.session.persistentAnchors as string[]);
const sitAt = async (page: Page, x: number) => {
  await page.evaluate((at) => (window as Win).__xrDevice.position.set(at, 1.2, 0), x);
  await frames(page, 5);
};
const savedAnchorIsNot = (page: Page, uuid: string | undefined) =>
  page.waitForFunction((old) => {
    const room = JSON.parse(localStorage.getItem('spatialdesk.room') ?? 'null');
    return room?.uuid && room.uuid !== old;
  }, uuid, { timeout: 5_000 });
/** Leaves the room and comes back; resolves once a remembered layout, if any, has had its moment to return. */
const reenterRoom = async (page: Page) => {
  await page.evaluate(() => (window as Win).__world.exitXR());
  await flat(page);
  await frames(page, 30);
  await enterRoom(page);
};
/** IWSDK's own persistent anchor, for scene understanding, and at most one of ours: what the site should hold. */
const expectOneOfOurs = async (page: Page, label: string) => {
  const { iwsdk, all } = await page.evaluate(() => ({ iwsdk: localStorage.getItem('iwsdk_scene_anchor_uuid'), all: (window as Win).__world.session.persistentAnchors as string[] }));
  expect(iwsdk, 'IWSDK kept its anchor').toBeTruthy();
  expect([...all].sort(), label).toEqual([iwsdk!, (await saved(page))!.uuid].sort());
};
/** Earlier anchors left on the headset, under IWER's own storage for them: there when the session starts. */
const leftBehind = (page: Page, count: number) =>
  page.addInitScript((n) => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    localStorage.setItem('@immersive-web-emulation-runtime/persistent-anchors', JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [`left-behind-${i}`, identity]))));
  }, count);

test('Fit room twelve times, each from a new seat, under Meta\'s limit of 8: one anchor of ours throughout, and the last layout comes back in place', async ({ page }) => {
  test.setTimeout(180_000);
  await onboarded(page);
  const errors = await openWorkspace(page, '?emulate&room=office_small');
  await sitAt(page, 0);
  await enterRoom(page);
  await fit(page);
  await savedAnchorIsNot(page, undefined);
  // The emulator has no limit of its own: this one refuses the ninth, as Meta's guide says a site can only have 8.
  await page.evaluate(() => {
    const w = window as Win;
    const proto = Object.getPrototypeOf(w.__room.anchor);
    const real = proto.requestPersistentHandle;
    w.__refused = 0;
    proto.requestPersistentHandle = function () {
      if (w.__world.session.persistentAnchors.length < 8) return real.call(this);
      w.__refused++;
      return Promise.reject(new DOMException('Too many persistent anchors.', 'QuotaExceededError'));
    };
  });
  const handles = new Set([(await saved(page))!.uuid]);
  for (let i = 1; i < 12; i++) {
    await sitAt(page, i * 0.05);
    const before = (await saved(page))!.uuid;
    await fit(page);
    await savedAnchorIsNot(page, before);
    await expectOneOfOurs(page, `after fit ${i + 1}`);
    handles.add((await saved(page))!.uuid);
  }
  expect(handles.size, 'each fit its own handle').toBe(12);
  expect(await page.evaluate(() => (window as Win).__refused)).toBe(0);

  const here = await boardPlaces(page);
  await reenterRoom(page);
  await page.waitForFunction(() => (window as Win).__room.state.restored > 0, null, { timeout: 10_000 });
  const back = await boardPlaces(page);
  for (let i = 0; i < here.length; i++) expect(Math.hypot(back[i].x - here[i].x, back[i].y - here[i].y, back[i].z - here[i].z), `board ${i}`).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test('a headset already holding 8 anchors from before, and a deletion that never answers: the old ones go, IWSDK\'s stays, and the fit is remembered', async ({ page }) => {
  test.setTimeout(120_000);
  await onboarded(page);
  await leftBehind(page, 7);
  const errors = await openWorkspace(page, '?emulate&room=office_small');
  await sitAt(page, 0);
  await enterRoom(page);
  await page.waitForFunction(() => localStorage.getItem('iwsdk_scene_anchor_uuid'), null, { timeout: 5_000 });
  expect((await persistentAnchors(page)).length, 'seven, and IWSDK\'s').toBe(8);
  // The WebXR Anchors draft's own steps never resolve this promise: it must not hold the fit up.
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf((window as Win).__world.session);
    const real = proto.deletePersistentAnchor;
    proto.deletePersistentAnchor = function (uuid: string) {
      void real.call(this, uuid);
      return new Promise(() => {});
    };
  });
  await fit(page);
  await savedAnchorIsNot(page, undefined);
  await expectOneOfOurs(page, 'after the fit');
  expect(await page.evaluate(() => (window as Win).__glide.active() >= 0), 'the frame loop is still running').toBe(true);
  await frames(page, 10);
  expect(errors).toEqual([]);
});

test('a browser with no way to delete anchors and already at the limit: no ninth is asked for, the fit stands for the visit, and it says so', async ({ page }) => {
  test.setTimeout(120_000);
  await onboarded(page);
  await leftBehind(page, 7);
  const errors = await openWorkspace(page, '?emulate&room=office_small');
  await sitAt(page, 0);
  await enterRoom(page);
  await page.waitForFunction(() => localStorage.getItem('iwsdk_scene_anchor_uuid'), null, { timeout: 5_000 });
  await page.evaluate(() => {
    Object.getPrototypeOf((window as Win).__world.session).deletePersistentAnchor = undefined;
  });
  await fit(page);
  await page.waitForFunction(() => (window as Win).__notice?.text?.includes('could not remember this room'), null, { timeout: 5_000 });
  expect((await notice(page))?.error).toBe(false);
  expect(await page.evaluate(() => (window as Win).__room.state.lastFit.desk), 'the fit itself stands').toBe(true);
  expect((await persistentAnchors(page)).length, 'no ninth').toBe(8);
  expect(await saved(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('the headset refuses a persistent anchor: the fit stands for the visit, it says so, and no layout comes back in the wrong place', async ({ page }) => {
  test.setTimeout(120_000);
  await onboarded(page);
  const errors = await openWorkspace(page, '?emulate&room=office_small');
  await sitAt(page, 0);
  await enterRoom(page);
  await fit(page);
  await savedAnchorIsNot(page, undefined);
  await page.evaluate(() => {
    const anchor = (window as Win).__room.anchor;
    Object.getPrototypeOf(anchor).requestPersistentHandle = () => Promise.reject(new DOMException('Too many persistent anchors.', 'QuotaExceededError'));
  });
  await sitAt(page, 0.5); // sitting somewhere else this time
  await fit(page);
  await page.waitForFunction(() => (window as Win).__notice?.text?.includes('could not remember this room'), null, { timeout: 5_000 });
  expect((await notice(page))?.error).toBe(false);
  expect(await page.evaluate(() => (window as Win).__room.state.lastFit.desk), 'the fit itself stands').toBe(true);
  expect(await saved(page), 'no layout under a handle it does not belong to').toBeNull();
  expect(await page.evaluate(() => (window as Win).__room.remembers)).toBe(false);

  // With nothing remembered, entering arranges around the viewer as on any first visit; it used to restore 0.5 m out.
  await reenterRoom(page);
  await frames(page, 30);
  expect(await page.evaluate(() => (window as Win).__room.state.restored), 'nothing to bring back').toBe(0);
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

test('a long sitting: cards, comfort changes, and boards and timers created and removed leave nothing behind', async ({ page }) => {
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

  // A panel removed used to keep about 3.3 MB (a board) or 0.4 MB and a geometry (a timer): UIKit stops only the component
  // it is told to, so the rest of a panel stayed alive (stopComponents, src/workspace/pinned.ts).
  await rounds('board', 2); // what the first of each kind allocates once is not a leak
  await rounds('timer', 2);
  const warm = await measure();
  await rounds('board', 20);
  const boarded = await measure();
  await rounds('timer', 20);
  const timed = await measure();
  console.log(`SOAK ${JSON.stringify({ start, worked, warm, boarded, timed })}`);
  expect(timed.objects, 'nothing is left in the scene').toBe(start.objects);
  expect(timed.textures).toBe(start.textures);
  expect(timed.geometries, 'and no geometry').toBe(warm.geometries);
  // It used to come to 66 MB and 8 MB. The heap moves by a few MB between measures, whatever happens: hence the margin.
  expect(boarded.heapMB - warm.heapMB, 'JS heap after 20 boards removed, MB').toBeLessThan(10);
  expect(timed.heapMB - warm.heapMB, 'and after 20 timers more, MB').toBeLessThan(10);
  expect(errors).toEqual([]);
});
