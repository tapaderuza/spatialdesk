import { defineConfig } from '@playwright/test';

// Uses the Edge already installed on Windows (no browser download). Measures the PRODUCTION build (what the
// judges' Quest downloads), with the IWER Quest 3 emulator loaded only for the test via ?emulate.
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    // A visitor who has been through the guided setup (src/onboarding/setup-state.ts): the first-run setup would otherwise
    // open in front of every test that enters XR. tests/setup.spec.ts starts from an empty storage to see it.
    storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'spatialdesk.calibrated', value: '1' }] }] },
    channel: process.env.PW_CHANNEL ?? 'msedge',
    headless: process.env.PW_HEADED !== '1',
    viewport: { width: 1280, height: 960 },
    launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
