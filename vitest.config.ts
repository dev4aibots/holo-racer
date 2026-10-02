import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default defineConfig({
  ...viteConfig,
  test: {
    // Playwright e2e specs live under tests/e2e and run via `npm run test:e2e`.
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
