import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

// Everything is served from our own origin (no third-party CDN at runtime): fewer failure points for the judges.
export default defineAssets({
  'command-panel': {
    url: publicAssetUrl('ui/command.uikitml'),
    type: AssetType.UIKitML,
    name: 'Command Panel',
  },
});
