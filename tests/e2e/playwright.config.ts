import { defineConfig, devices } from '@playwright/test'
import { WEB_URL } from './lib/env'

/** The demo script (build plan "Demo script and acceptance", steps 1-7) runs in order against one stack: one worker,
 * files in name order. `setup` publishes the history months through the API; `demo` is the journeys plus the negative
 * tests. */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  // 30 s: on a CPU-starved host (antivirus plus several stacks) the Vite dev server has taken 10-20 s to serve a page.
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /setup\/.*\.setup\.ts/ },
    { name: 'demo', testMatch: /specs\/.*\.spec\.ts/, dependencies: ['setup'] },
  ],
})
