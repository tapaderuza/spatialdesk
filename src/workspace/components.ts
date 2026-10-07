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
