import { defineConfig, devices } from '@playwright/test';

const webPort = 3110;
const apiPort = 4110;
const webUrl = `http://localhost:${webPort}`;
const apiUrl = `http://localhost:${apiPort}`;

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: webUrl,
    // Tests run signed in as the seeded owner, through a fixed dev-only token.
    // Sign-in tests clear their cookies first.
    storageState: {
      cookies: [
        {
          name: 'fm_session',
          value: 'dev-owner',
          domain: 'localhost',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /\/perf\//,
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
  webServer: [
    {
      command: 'pnpm --filter @forgemind/dev-api start',
      url: `${apiUrl}/health`,
      env: {
        PORT: String(apiPort),
        WEB_ORIGIN: webUrl,
        DEV_API_ORIGIN: apiUrl,
      },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm build && pnpm start --port ${webPort}`,
      url: webUrl,
      env: { ENABLE_DESIGN_PAGE: '1', NEXT_PUBLIC_API_URL: apiUrl },
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
