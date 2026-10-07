/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { APP_SYSTEMS } from './app-systems.js';
import { installPerfProbe } from './perf/probe.js';
import { maybeInstallEmulator } from './emulator.js';
import { workspace } from './workspace/store.js';

await maybeInstallEmulator();
await workspace.load(); // IndexedDB, a few ms: the systems start with the saved workspace

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  (window as unknown as { __world: typeof world }).__world = world; // scene access for the Playwright tests
  for (const system of APP_SYSTEMS) world.registerSystem(system);
  if (new URLSearchParams(location.search).has('perf')) installPerfProbe(world, APP_SYSTEMS);
});
