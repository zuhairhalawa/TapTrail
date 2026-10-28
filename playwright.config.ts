import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/TapTrail/`,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', testIgnore: /mobile\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  // Test the production build (with its Content-Security-Policy), served under the GitHub Pages base path.
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/TapTrail/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});