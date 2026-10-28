import { createComponent, Types } from '@iwsdk/core';

// System-free module (IWSDK rule): listed in src/components.ts so the editor knows them too.

/** A board or timer panel; `item` is the workspace id ("b1", "t7"). */
export const PinnedItem = createComponent('PinnedItem', {
  item: { type: Types.String, default: '' },
});

/** The grab bar under a pinned panel; moving it moves the panel. */
export const PinnedHandle = createComponent('PinnedHandle', {
  item: { type: Types.String, default: '' },
});

/** The agent's plan preview panel (one per world). */
export const AgentPanel = createComponent('AgentPanel', {});

/** The first-run coach banner (one per world). */
export const CoachPanel = createComponent('CoachPanel', {});

/** The guided setup panel: where you sit, reach out and pinch the orb, steady aim (one per world). */
export const SetupPanel = createComponent('SetupPanel', {});

/** The helper panel: a code to invite a family member or carer, their request, and the state of the sharing (one per world). */
export const HelperPanel = createComponent('HelperPanel', {});

/** The welcome-back banner above the work board, for the first seconds in the headset (one per world). */
export const WelcomePanel = createComponent('WelcomePanel', {});
