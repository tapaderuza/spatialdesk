/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Emulator in your own browser is all we use: don't launch (or download) the plugin's managed Chromium.
// `npm run dev` (the iwsdk CLI) can still override this through its own flags.
process.env.IWSDK_DEV_OPEN ??= 'false';

/**
 * IWER's synthetic rooms (`?emulate&room=home_office`, src/emulator.ts) import their scene from `/rooms/<id>.js`,
 * next to the package root as SEM resolves it. They are served from node_modules in dev and copied into the build;
 * a headset never fetches them (only the emulator does).
 */
function semRooms(): Plugin {
  // Procedural rooms (rooms/*.js) and scanned rooms (captures/*.json), each served under its own folder name.
  const folders = { rooms: '.js', captures: '.json' } as const;
  const files = (folder: keyof typeof folders) => {
    const source = `node_modules/@iwer/sem/${folder}`;
    return existsSync(source) ? readdirSync(source).filter((f) => f.endsWith(folders[folder])) : [];
  };
  return {
    name: 'spatialdesk-sem-rooms',
    enforce: 'pre',
    // The procedural rooms are built by GLTS, which needs the three.js SEM was built with (r184, the `three-r184`
    // alias): the app's own super-three r181 (package.json override) cannot build them.
    async resolveId(source, importer, options) {
      if ((source === 'three' || source.startsWith('three/')) && importer?.includes('@drawcall/glts')) {
        return this.resolve(source.replace(/^three/, 'three-r184'), importer, { ...options, skipSelf: true });
      }
      return null;
    },
    configureServer(server) {
      for (const folder of Object.keys(folders) as (keyof typeof folders)[]) {
        server.middlewares.use(`/${folder}`, (req, res, next) => {
          const file = (req.url ?? '').replace(/^\//, '').split('?')[0];
          if (!files(folder).includes(file)) return next();
          res.setHeader('Content-Type', folder === 'rooms' ? 'text/javascript' : 'application/json');
          res.end(readFileSync(join('node_modules/@iwer/sem', folder, file)));
        });
      }
    },
    writeBundle(options) {
      for (const folder of Object.keys(folders) as (keyof typeof folders)[]) {
        const target = join(options.dir ?? 'dist', folder);
        mkdirSync(target, { recursive: true });
        for (const file of files(folder)) copyFileSync(join('node_modules/@iwer/sem', folder, file), join(target, file));
      }
    },
  };
}

// The command server that dev and preview forward /api and /ws to: one running locally by default, or a deployed one
// with SPATIALDESK_API=https://... (the recording mode films a local build against production without deploying it).
const api = process.env.SPATIALDESK_API ?? 'http://localhost:8080';
const proxy = {
  '/api': { target: api, changeOrigin: true },
  '/ws': { target: api.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
};

export default defineConfig({
  // No headset in this project (emulator only): localhost over HTTP is already a secure context for WebXR,
  // so no self-signed certificate is needed.
  plugins: [iwsdkDev({ https: false }), semRooms()],
  server: {
    host: '0.0.0.0',
    port: 8081,
    open: false,
    // Same paths as production (CloudFront routes /api and /ws to the backend): the app never knows the difference.
    proxy,
  },
  preview: { proxy },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: {
      // Two pages: the app, and the light 2D companion for a family member or carer (it never loads the XR world).
      input: { main: './index.html', companion: './companion.html' },
      // The emulator chunks are only fetched with ?emulate (and ?room for the synthetic room); naming them lets the
      // perf gate attribute their cost and the size gate leave them out.
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/iwer')) return 'emulator';
          if (/node_modules\/(@iwer|@drawcall\/glts|@bufbuild|ts-proto)\//.test(id)) return 'emulator-room';
          return undefined;
        },
      },
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
