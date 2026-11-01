import { defineConfig, devices } from '@playwright/test';

const webPort = 3110;
const apiPort = 4110;
const webUrl = `http://localhost:${webPort}`;
const apiUrl = `http://localhost:${apiPort}`;

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: webUrl,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @forgemind/dev-api start',
      url: `${apiUrl}/health`,
      env: { PORT: String(apiPort), WEB_ORIGIN: webUrl },
    },
    {
      command: `pnpm build && pnpm start --port ${webPort}`,
      url: webUrl,
      env: { ENABLE_DESIGN_PAGE: '1', NEXT_PUBLIC_API_URL: apiUrl },
      timeout: 180_000,
    },
  ],
});
