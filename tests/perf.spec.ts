/**
 * Performance gate (ROADMAP heuristic A): enters XR in the IWER Quest 3 emulator with the CPU throttled,
 * measures main-thread cost per frame inside IWSDK's render loop, allocations per frame (V8 sampling heap
 * profiler, including objects already collected) and scene budgets. Any budget exceeded fails the build.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { populateWorstCase } from './workload.js';

interface Budgets {
  cpuThrottlingRate: number;
  warmupSeconds: number;
  measureSeconds: number;
  appSystemsP95Ms: number;
  appSystemsP99Ms: number;
  framePerFrameP95Ms: number;
  allocatedBytesPerFrame: number;
  drawCalls: number;
  triangles: number;
  heapUsedMB: number;
  minFramesMeasured: number;
}

interface ProfileNode { selfSize: number; children: ProfileNode[]; callFrame: { url: string } }
/** Bytes allocated, split by who allocated: the emulator (absent on a real Quest) or everything else. */
function tally(node: ProfileNode, out = { emulator: 0, app: 0 }, inEmulator = false) {
  const emulator = inEmulator || /\/emulator-[^/]*\.js/.test(node.callFrame.url);
  out[emulator ? 'emulator' : 'app'] += node.selfSize;
  for (const child of node.children) tally(child, out, emulator);
  return out;
}

const budgets: Budgets = JSON.parse(readFileSync('perf-budgets.json', 'utf-8'));

test('XR scene stays within the Quest performance budgets', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?perf&emulate');
  await page.waitForFunction(() => 'iwsdkPerf' in window || '__perf' in window, null, { timeout: 60_000 });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });

  // Enter the immersive session in the emulator (same call the "Enter XR" button makes).
  await page.evaluate(() => (window as any).__perf.launchXR());
  await page.waitForFunction(() => (window as any).__perf.snapshot().inXR, null, { timeout: 30_000 });

  await populateWorstCase(page); // measured on the heaviest workspace the engine allows

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: budgets.cpuThrottlingRate });
  await page.waitForTimeout(budgets.warmupSeconds * 1000);

  await page.evaluate(() => (window as any).__perf.reset());
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 1024,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await page.waitForTimeout(budgets.measureSeconds * 1000);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const snap = await page.evaluate(() => (window as any).__perf.snapshot());
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const bytes = tally(profile.head as unknown as ProfileNode);
  const perFrame = snap.frames > 0 ? bytes.app / snap.frames : Infinity;
  const emulatorPerFrame = snap.frames > 0 ? bytes.emulator / snap.frames : 0;
  const report = {
    date: new Date().toISOString(),
    gpu,
    cpuThrottlingRate: budgets.cpuThrottlingRate,
    frames: snap.frames,
    fps: +(snap.frames / budgets.measureSeconds).toFixed(1),
    appSystemsMs: { p50: +snap.app.p50.toFixed(3), p95: +snap.app.p95.toFixed(3), p99: +snap.app.p99.toFixed(3), max: +snap.app.max.toFixed(3) },
    wholeFrameMs: { p50: +snap.p50.toFixed(3), p95: +snap.p95.toFixed(3), p99: +snap.p99.toFixed(3), max: +snap.max.toFixed(3) },
    allocatedBytesPerFrame: Math.round(perFrame),
    emulatorBytesPerFrameExcluded: Math.round(emulatorPerFrame),
    drawCalls: snap.drawCalls,
    triangles: snap.triangles,
    textures: snap.textures,
    geometries: snap.geometries,
    heapUsedMB: snap.heapUsedMB === null ? null : +snap.heapUsedMB.toFixed(1),
    budgets,
  };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/perf-report.json', JSON.stringify(report, null, 2));
  console.log('PERF REPORT', JSON.stringify(report));

  expect(errors, 'no uncaught errors in the page').toEqual([]);
  expect(snap.frames, 'enough frames measured').toBeGreaterThanOrEqual(budgets.minFramesMeasured);
  expect.soft(snap.app.p95, 'our systems, ms per frame p95').toBeLessThanOrEqual(budgets.appSystemsP95Ms);
  expect.soft(snap.app.p99, 'our systems, ms per frame p99').toBeLessThanOrEqual(budgets.appSystemsP99Ms);
  expect.soft(snap.p95, 'whole frame p95 vs Meta reference scene (ms)').toBeLessThanOrEqual(budgets.framePerFrameP95Ms);
  expect.soft(perFrame, 'bytes allocated per frame').toBeLessThanOrEqual(budgets.allocatedBytesPerFrame);
  expect.soft(snap.drawCalls, 'draw calls per frame').toBeLessThanOrEqual(budgets.drawCalls);
  expect.soft(snap.triangles, 'triangles per frame').toBeLessThanOrEqual(budgets.triangles);
  if (snap.heapUsedMB !== null) expect.soft(snap.heapUsedMB, 'JS heap (MB)').toBeLessThanOrEqual(budgets.heapUsedMB);
});
