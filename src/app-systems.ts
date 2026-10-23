import type { World } from '@iwsdk/core';
import { AgentSystem } from './agent/agent-system.js';
import { CoachSystem } from './onboarding/coach.js';
import { PanelSystem } from './panel.js';
import { RoomSystem } from './room/room-system.js';
import { StudioSystem } from './studio/studio-system.js';
import { GazeSystem } from './ui/gaze.js';
import { HoverSystem } from './ui/hover.js';
import { BoardSystem } from './workspace/boards.js';
import { PinnedSystem } from './workspace/pinned.js';
import { TimerSystem } from './workspace/timers.js';

/**
 * Every system WE write is registered from here, so the performance gate can time exactly our code
 * (budget: p95 <= 3 ms per frame with the CPU throttled) separately from the framework's own systems.
 * PinnedSystem first: it attaches the panel documents the board and timer systems fill. GazeSystem last: it presses
 * controls the other systems have laid out this frame. HoverSystem after it: it fades whatever the frame hovered.
 */
type SystemClass = Parameters<World['registerSystem']>[0];

export const APP_SYSTEMS: readonly SystemClass[] = [
  PinnedSystem,
  BoardSystem,
  TimerSystem,
  AgentSystem,
  RoomSystem,
  StudioSystem,
  PanelSystem,
  CoachSystem,
  GazeSystem,
  HoverSystem,
];
