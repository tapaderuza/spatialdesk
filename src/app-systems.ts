import type { World } from '@iwsdk/core';
import { ReachSystem } from './accessibility/reach-system.js';
import { HelperSystem } from './assist/helper-system.js';
import { AnchorFeedbackSystem } from './ui/anchor-feedback.js';
import { SwitchSystem } from './accessibility/switch-system.js';
import { AgentSystem } from './agent/agent-system.js';
import { CoachSystem } from './onboarding/coach.js';
import { WelcomeSystem } from './onboarding/welcome.js';
import { SetupSystem } from './onboarding/setup.js';
import { PanelSystem } from './panel.js';
import { RoomSystem } from './room/room-system.js';
import { CompanionSystem } from './studio/companion-system.js';
import { FocusBubbleSystem } from './studio/focus-bubble.js';
import { StudioSystem } from './studio/studio-system.js';
import { WanderSystem } from './studio/wander.js';
import { AttentionSystem } from './ui/attention.js';
import { GazeSystem } from './ui/gaze.js';
import { GlideSystem } from './ui/glide.js';
import { PokeSystem } from './ui/poke.js';
import { PanelShadowSystem } from './ui/panel-shadows.js';
import { HoverSystem } from './ui/hover.js';
import { SpatialAudioSystem } from './ui/sounds.js';
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
  GlideSystem, // right after: moves the panels that are sliding before anything reads where they are
  PanelShadowSystem, // after the glide: each shadow follows its panel in the same frame
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
  WelcomeSystem, // the first seconds for someone who has been here before: what to do, above the board
  GazeSystem,
  AttentionSystem, // what the eyes rest on, five times a second: "this" for the agent
  PokeSystem, // a fingertip pushes what it touches; after the gaze, like it a way to press
  SwitchSystem, // before HoverSystem, which fades the control it lights
  ReachSystem,
  SetupSystem, // after ReachSystem, whose measurement its second question takes
  HelperSystem, // a family member or carer follows along from a phone; their Help call opens the setup above
  AnchorFeedbackSystem, // the amber flash and the faint pulse when the space settles on the body or a surface
  HoverSystem,
  SpatialAudioSystem, // last: every sounding cue placed around the ears where its panel is this frame
];
