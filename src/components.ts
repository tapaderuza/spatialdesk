import { defineComponents } from '@iwsdk/core';
import { AgentPanel, CoachPanel, HelperPanel, PinnedHandle, PinnedItem, SetupPanel, WelcomePanel } from './workspace/components.js';

export default defineComponents([PinnedItem, PinnedHandle, AgentPanel, CoachPanel, SetupPanel, HelperPanel, WelcomePanel]);
