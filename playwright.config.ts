import { defineConfig, devices } from '@playwright/test';

// E2E runs against the PRODUCTION build via `vite preview`, NOT `vite dev`: Node 26's dev
// server has a publicDir bug that breaks the /rail/*.json asset, so the real network never
// loads under dev. Chromium's bundled SwiftShader provides the headless WebGL that MapLibre
// needs and that plain headless `$B` browse lacks — this is the harness that finally makes
// the zoom-tiered LOD verifiable in CI.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Software GL so headless Chromium can create a WebGL2 context for MapLibre.
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
