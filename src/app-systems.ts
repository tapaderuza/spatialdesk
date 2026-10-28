import type { World } from '@iwsdk/core';
import { ReachSystem } from './accessibility/reach-system.js';
import { AnchorFeedbackSystem } from './ui/anchor-feedback.js';
import { SwitchSystem } from './accessibility/switch-system.js';
import { AgentSystem } from './agent/agent-system.js';
import { CoachSystem } from './onboarding/coach.js';
import { SetupSystem } from './onboarding/setup.js';
import { PanelSystem } from './panel.js';
import { RoomSystem } from './room/room-system.js';
import { CompanionSystem } from './studio/companion-system.js';
import { FocusBubbleSystem } from './studio/focus-bubble.js';
import { StudioSystem } from './studio/studio-system.js';
import { WanderSystem } from './studio/wander.js';
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
  WanderSystem, // before the companion, which shows its call in the same frame
  CompanionSystem,
  FocusBubbleSystem,
  PanelSystem,
  CoachSystem,
  GazeSystem,
  SwitchSystem, // before HoverSystem, which fades the control it lights
  ReachSystem,
  SetupSystem, // after ReachSystem, whose measurement its second question takes
  AnchorFeedbackSystem, // the amber flash and the faint pulse when the space settles on the body or a surface
  HoverSystem,
];
