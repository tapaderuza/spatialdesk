import type { World } from '@iwsdk/core';
import { PanelSystem } from './panel.js';
import { BoardSystem } from './workspace/boards.js';
import { PinnedSystem } from './workspace/pinned.js';
import { TimerSystem } from './workspace/timers.js';

/**
 * Every system WE write is registered from here, so the performance gate can time exactly our code
 * (budget: p95 <= 3 ms per frame with the CPU throttled) separately from the framework's own systems.
 * PinnedSystem first: it attaches the panel documents the board and timer systems fill.
 */
type SystemClass = Parameters<World['registerSystem']>[0];

export const APP_SYSTEMS: readonly SystemClass[] = [PinnedSystem, BoardSystem, TimerSystem, PanelSystem];
