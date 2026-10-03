/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

// Emulator in your own browser is all we use: don't launch (or download) the plugin's managed Chromium.
// `npm run dev` (the iwsdk CLI) can still override this through its own flags.
process.env.IWSDK_DEV_OPEN ??= 'false';

export default defineConfig({
  // No headset in this project (emulator only): localhost over HTTP is already a secure context for WebXR,
  // so no self-signed certificate is needed.
  plugins: [iwsdkDev({ https: false })],
  server: {
    host: '0.0.0.0',
    port: 8081,
    open: false,
    // Same paths as production (CloudFront routes /api and /ws to the backend): the app never knows the difference.
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  preview: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: {
      input: './index.html',
      // The emulator chunk is only fetched with ?emulate; naming it lets the perf gate attribute its cost.
      output: { manualChunks: (id) => (id.includes('node_modules/iwer') ? 'emulator' : undefined) },
    },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
