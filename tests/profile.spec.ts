import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { populateWorstCase } from './workload.js';

// Diagnostic (not part of the gate): where the frame time goes on the worst-case workspace, by self time (the
// function itself) and inclusive time (with everything it calls). Run with `npm run perf:profile`.
test('cpu profile (diagnostic, PERF_PROFILE=1)', async ({ page }) => {
  test.skip(!process.env.PERF_PROFILE, 'diagnostic only');
  await page.goto('/?perf&emulate');
  await page.waitForFunction(() => '__perf' in window, null, { timeout: 60000 });
  await page.evaluate(() => (window as any).__perf.launchXR());
  await page.waitForFunction(() => (window as any).__perf.snapshot().inXR, null, { timeout: 30000 });
  await populateWorstCase(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 3 });
  await page.waitForTimeout(3000);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.waitForTimeout(8000);
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
  const parent = new Map<number, any>();
  for (const n of profile.nodes as any[]) for (const c of n.children ?? []) parent.set(c, n);
  const name = (n: any) => `${n.callFrame.functionName || '(anon)'}@${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`;
  const dt = profile.timeDeltas!;
  const self = new Map<string, number>();
  const inclusive = new Map<string, number>();
  profile.samples!.forEach((id: number, i: number) => {
    const n = byId.get(id);
    self.set(name(n), (self.get(name(n)) ?? 0) + (dt[i] ?? 0));
    const seen = new Set<string>();
    for (let p = n; p; p = parent.get(p.id)) {
      const k = name(p);
      if (!seen.has(k)) {
        seen.add(k);
        inclusive.set(k, (inclusive.get(k) ?? 0) + (dt[i] ?? 0));
      }
    }
  });
  const fmt = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`).join('\n');
  // Who spends it: for the costly leaf functions, the call chain above them (four frames), by time under each chain.
  const chains = new Map<string, number>();
  profile.samples!.forEach((id: number, i: number) => {
    const n = byId.get(id);
    if (!/^(traverse|updateWorldMatrix|getParameter|compose)@/.test(name(n))) return;
    const up: string[] = [];
    const k0 = name(n).replace(/@index-[^:]*/, '@');
    for (let p = parent.get(n.id); p && up.length < 4; p = parent.get(p.id)) {
      const frame = name(p).replace(/@index-[^:]*/, '@');
      if (frame !== up[up.length - 1] && frame !== k0) up.push(frame); // a recursion counts once
    }
    const k = `${name(n).replace(/@index-[^:]*/, '@')}  <-  ${up.join('  <-  ')}`;
    chains.set(k, (chains.get(k) ?? 0) + (dt[i] ?? 0));
  });
  writeFileSync('test-results/cpu-top.txt', `self time\n${fmt(self, 40)}\n\ninclusive time\n${fmt(inclusive, 60)}\n\ncallers\n${fmt(chains, 14)}\n`);
});
