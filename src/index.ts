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
import { bindHead } from './ui/sounds.js';
import { installPanelUiCache } from './ui/panel-ui-cache.js';

installPanelUiCache(); // before the world creates PanelUISystem: it stops walking the whole scene every frame
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
  bindHead(world.camera); // cues sound from where they happen (src/ui/sounds.ts)
  for (const system of APP_SYSTEMS) world.registerSystem(system);
  if (new URLSearchParams(location.search).has('perf')) installPerfProbe(world, APP_SYSTEMS);
  // The dark splash of index.html goes once the world has drawn: never a white page, never a jump to an empty one.
  requestAnimationFrame(() => requestAnimationFrame(hideSplash));
}).catch((error: unknown) => {
  const line = document.querySelector('#splash .line');
  if (line) line.textContent = 'SpatialDesk could not start in this browser. Reload the page, or try another browser.';
  throw error;
});

function hideSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('gone'); // takes no pointer from here on, and fades
  setTimeout(() => splash.remove(), 600);
}
