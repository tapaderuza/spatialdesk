/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { SessionMode, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { APP_SYSTEMS } from './app-systems.js';
import { installPerfProbe } from './perf/probe.js';
import { maybeInstallEmulator } from './emulator.js';
import { workspace } from './workspace/store.js';
import { bindColorScheme } from './ui/settings.js';

await maybeInstallEmulator();
await workspace.load(); // IndexedDB, a few ms: the systems start with the saved workspace

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  (window as unknown as { __world: typeof world }).__world = world; // scene access for the Playwright tests
  // iwsdk.config.json says "ar" so the renderer keeps an alpha channel for passthrough; a plain launch is still VR,
  // without asking for the room (src/room/room-system.ts launches the room explicitly).
  world.xrDefaults = { ...world.xrDefaults, sessionMode: SessionMode.ImmersiveVR, features: { handTracking: true, gazeTracking: true } };
  bindColorScheme(world); // high contrast (or not) before any panel shows
  for (const system of APP_SYSTEMS) world.registerSystem(system);
  if (new URLSearchParams(location.search).has('perf')) installPerfProbe(world, APP_SYSTEMS);
});
