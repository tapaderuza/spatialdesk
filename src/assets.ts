import { AssetType, defineAssets } from '@iwsdk/core';
import horizon from './scene-assets/dusk-horizon.scene-asset.js';
import companion from './scene-assets/focus-companion.scene-asset.js';
import plant from './scene-assets/focus-plant.scene-asset.js';
import desk from './scene-assets/studio-desk.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

// Everything is served from our own origin (no third-party CDN at runtime): fewer failure points for the judges.
export default defineAssets({
  'command-panel': {
    url: publicAssetUrl('ui/command.uikitml'),
    type: AssetType.UIKitML,
    name: 'Command Panel',
  },
  'agent-panel': {
    url: publicAssetUrl('ui/plan.uikitml'),
    type: AssetType.UIKitML,
    name: 'Companion and Plan',
  },
  // The VR studio (procedural, one draw call each): src/scene-assets.
  'studio-desk': desk,
  'focus-plant': plant,
  'dusk-horizon': horizon,
  'focus-companion': companion,
});
