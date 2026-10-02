import { defineConfig, devices } from '@playwright/test';

/**
 * HOLO-RACER end-to-end tests.
 *
 * Run:  npm run test:e2e
 * First time only: npx playwright install chromium
 *
 * The suite drives the game exactly like a player would: menu -> countdown ->
 * keyboard driving -> pause/resume -> settings. Any console error or uncaught
 * exception fails the run. Software WebGL (SwiftShader) is enabled so the
 * suite also passes on machines without a GPU — rendering is just slower,
 * so waits are generous.
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false, // one game instance at a time
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 120_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Software GL fallback so CI / GPU-less machines can still render.
      args: ['--enable-unsafe-swiftshader'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
