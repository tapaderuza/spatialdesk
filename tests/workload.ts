import type { Page } from '@playwright/test';

/**
 * The heaviest workspace the engine allows (Limits.kt): 4 boards x 4 columns with every card slot filled (plus
 * overflow), and 3 running timers counting down. Performance is always measured on this, never on the light
 * first-run workspace.
 */
export async function populateWorstCase(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ws = (window as any).__workspace;
    const columns = ['Backlog', 'To do', 'Doing', 'Done'];
    const boards = [1, 2, 3, 4].map((b) => ({
      op: 'create_board',
      title: `Load test board ${b}`,
      columns,
      cards: columns.flatMap((column) =>
        [1, 2, 3, 4, 5].map((k) => ({ title: `Board ${b} ${column} task ${k} with a long title`, column, minutes: 25 })),
      ),
    }));
    const timers = [25, 50, 90].map((minutes) => ({ op: 'start_timer', minutes, label: `Load ${minutes}` }));
    const clear = ws.state.boards.map((b: { id: string }) => ({ op: 'delete_board', board: b.id }));
    const result = ws.dispatch([...clear, ...boards, ...timers]);
    if (!result.ok) throw new Error(result.error);
  });
  await page.waitForFunction(
    () => {
      let panels = 0;
      (window as any).__world.scene.traverse((o: any) => {
        if (/^(b|t)\d+:(board|timer)$/.test(o.name ?? '')) panels++;
      });
      return panels === 7;
    },
    null,
    { timeout: 30_000 },
  );
}
