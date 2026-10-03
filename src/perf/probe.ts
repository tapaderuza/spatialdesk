/**
 * Frame-cost probe for the automated performance gate (tests/perf.spec.ts). Active only with `?perf` in the URL.
 *
 * Measures main-thread CPU per frame inside IWSDK's own render loop: from the start of `world.update`
 * (ECS systems) to the end of `renderer.render` (scene traversal + WebGL command submission). GPU time is
 * not included: on a Quest the judges' GPU is the unknown, our JS is not.
 *
 * The probe itself must not allocate per frame: fixed typed-array ring buffer, no closures created per frame.
 */
import type { World } from '@iwsdk/core';

type SystemClass = Parameters<World['getSystem']>[0];

const CAPACITY = 8192;

export interface PerfSnapshot {
  frames: number;
  /** Our own systems only (APP_SYSTEMS), ms per frame. */
  app: { p50: number; p95: number; p99: number; max: number };
  p50: number;
  p95: number;
  p99: number;
  max: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  heapUsedMB: number | null;
  inXR: boolean;
}

export function installPerfProbe(world: World, appSystems: readonly SystemClass[]): void {
  const samples = new Float64Array(CAPACITY);
  const appSamples = new Float64Array(CAPACITY);
  let count = 0;
  let frameStart = 0;
  let appTime = 0;

  for (const systemClass of appSystems) {
    const system = world.getSystem(systemClass) as unknown as { update?: (d: number, t: number) => void } | undefined;
    if (!system?.update) continue;
    const own = system.update.bind(system);
    system.update = (delta: number, time: number) => {
      const t0 = performance.now();
      own(delta, time);
      appTime += performance.now() - t0;
    };
  }
  let drawCalls = 0;
  let triangles = 0;

  const update = world.update.bind(world);
  world.update = (delta: number, time: number) => {
    frameStart = performance.now();
    update(delta, time);
  };

  const renderer = world.renderer;
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    render(scene, camera);
    if (frameStart !== 0) {
      samples[count % CAPACITY] = performance.now() - frameStart;
      appSamples[count % CAPACITY] = appTime;
      appTime = 0;
      count++;
      frameStart = 0;
      drawCalls = renderer.info.render.calls;
      triangles = renderer.info.render.triangles;
    }
  };

  const api = {
    reset(): void {
      count = 0;
    },
    snapshot(): PerfSnapshot {
      const n = Math.min(count, CAPACITY);
      const sorted = Array.from(samples.subarray(0, n)).sort((a, b) => a - b);
      const appSorted = Array.from(appSamples.subarray(0, n)).sort((a, b) => a - b);
      const q = (p: number) => (n === 0 ? 0 : sorted[Math.min(n - 1, Math.floor(p * n))]);
      const qa = (p: number) => (n === 0 ? 0 : appSorted[Math.min(n - 1, Math.floor(p * n))]);
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return {
        frames: count,
        app: { p50: qa(0.5), p95: qa(0.95), p99: qa(0.99), max: n === 0 ? 0 : appSorted[n - 1] },
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        max: n === 0 ? 0 : sorted[n - 1],
        drawCalls,
        triangles,
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
        heapUsedMB: memory ? memory.usedJSHeapSize / 1048576 : null,
        inXR: world.session !== undefined,
      };
    },
    launchXR(): void {
      // The gate measures CPU. At Quest 3 resolution (2 x 2064x2208) a laptop iGPU saturates and blocking WebGL
      // calls would show up as "CPU" time; a small framebuffer keeps the same draw calls and JS work.
      renderer.xr.setFramebufferScaleFactor(0.25);
      world.launchXR();
    },
  };
  (window as unknown as { __perf: typeof api }).__perf = api;
}
