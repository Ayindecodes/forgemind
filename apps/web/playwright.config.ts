import { defineConfig, devices } from '@playwright/test';

import { ownerState, webServers, webUrl } from './playwright.shared';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: webUrl,
    // Tests run signed in as the seeded owner. Sign-in tests clear their
    // cookies first.
    storageState: ownerState,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Timing tests have their own project below; screenshot tests have
      // their own config, because they need a store no other test is
      // changing.
      testIgnore: [/\/perf\//, /visual\.spec\.ts$/],
    },
    {
      // Timing tests run alone, after everything else, so other workers
      // cannot stretch their frames.
      name: 'perf',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /\/perf\/.*\.spec\.ts$/,
      dependencies: ['chromium'],
    },
  ],
  webServer: webServers({ apiSpeed: '1', reuse: !process.env.CI }),
});
