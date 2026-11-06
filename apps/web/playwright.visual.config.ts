import { defineConfig, devices } from '@playwright/test';

import { ownerState, webServers, webUrl } from './playwright.shared';

/*
 * Screenshot comparison runs on its own servers: the dev API plays every
 * seeded run to its end at once, so the store is the same every time, and
 * nothing else is changing it while the pictures are taken. Baselines are
 * captured on this Linux headless Chromium; `pnpm test:visual --update-snapshots`
 * refreshes them after an intended change.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /visual\.spec\.ts$/,
  // First loads of the heavier routes on a cold server take a while.
  timeout: 90_000,
  snapshotPathTemplate: '{testDir}/visual/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: webUrl,
    storageState: ownerState,
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'visual' }],
  webServer: webServers({ apiSpeed: 'Infinity', reuse: false }),
});
