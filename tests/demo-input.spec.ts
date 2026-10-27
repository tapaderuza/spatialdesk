import { expect, test } from '@playwright/test';
import { enterXR, frames, pressXR, turnHead, type Win } from './helpers.js';

test('demo: Plan my day remains selectable after the full comfort adaptation', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessionId: 'test-session-0000000000', protocol: 1 } }));
  await page.route('**/api/agent/plan', route => {
    requests.push(route.request().postDataJSON().intent);
    return route.fulfill({ json: { ok: true, summary: 'A day to review', steps: [], source: 'test' } });
  });
  await enterXR(page, '&fast');
  await pressXR(page, 'coach:coach-skip');
  await page.evaluate(() => (window as Win).__workspace.dispatch([
    { op: 'set_comfort', reach: 0.8 }, { op: 'set_comfort', side: 'right' },
    { op: 'set_comfort', scale: 1.5 }, { op: 'set_comfort', turnDeg: 25 },
  ]));
  await frames(page, 20);
  await turnHead(page, -26, -6, 14);
  await page.evaluate(() => {
    (window as Win).__demoEvents = [];
    (window as Win).__world.scene.traverse((o: any) => {
      if (!o.name?.endsWith('root') && !/^b\d+:board$/.test(o.name)) return;
      for (const type of ['pointerdown', 'click']) o.addEventListener(type, (e: any) => {
        (window as Win).__demoEvents.push({ name: o.name, type, point: e.point?.toArray() });
      });
    });
  });
  await pressXR(page, 'command:plan-button', 'right', 0);
  const measured = await page.evaluate(() => {
    const w = (window as Win).__world;
    const V = w.camera.position.constructor;
    const Q = w.camera.quaternion.constructor;
    let target: any;
    w.scene.traverse((o: any) => { if (o.name === 'command:plan-button') target = o; });
    const ray = w.player.raySpaces.right;
    return { events: (window as Win).__demoEvents, target: target.getWorldPosition(new V()).toArray(),
      rayOrigin: ray.getWorldPosition(new V()).toArray(),
      rayDirection: new V(0, 0, -1).applyQuaternion(ray.getWorldQuaternion(new Q())).toArray() };
  });
  console.log(JSON.stringify(measured));
  await expect.poll(() => requests, { timeout: 3000 }).toEqual(['plan_my_day']);
});
