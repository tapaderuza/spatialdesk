import type { Page } from '@playwright/test';

export type Win = Window & Record<string, any>;

/** Opens the app and waits until the first board's cards are laid out. Returns the page errors seen. */
export async function openWorkspace(page: Page, query = ''): Promise<string[]> {
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

/** Screen position (CSS px) of a point on a named element; (u, v) in [-0.5, 0.5] across it. */
export async function screenPoint(page: Page, name: string, u = 0, v = 0): Promise<{ x: number; y: number }> {
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

/** A real pointer tap: the pointer moves onto the element first, as a hand or a mouse would. */
export async function tap(page: Page, name: string, u = 0, v = 0): Promise<void> {
  const { x, y } = await screenPoint(page, name, u, v);
  await page.mouse.move(x - 12, y - 8);
  await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
}
