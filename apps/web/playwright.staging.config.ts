import { defineConfig, devices } from '@playwright/test';

/*
 * The steps of staging/, taken against a deployment that is already running:
 * nothing is built or started here. scripts/staging-check.sh runs them on a
 * deployment it makes, and docs/staging.md says how to run them on another.
 */
const url = process.env.STAGING_URL;
if (!url) {
  throw new Error(
    'STAGING_URL must be the address of the deployment, like https://staging.example.com',
  );
}

// The name and password a deployment asks of every visitor, as name:password.
const [username, ...rest] = (process.env.STAGING_VISITOR ?? '').split(':');

export default defineConfig({
  testDir: './staging',
  outputDir: './test-results/staging',
  // The steps are one person's, in order, on a deployment that keeps what
  // they did.
  workers: 1,
  timeout: 120_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: url,
    httpCredentials: username
      ? { username, password: rest.join(':') }
      : undefined,
    // Only for a deployment that signs its own certificate, as the check's does.
    ignoreHTTPSErrors: process.env.STAGING_OWN_CERTIFICATE === '1',
    trace: 'retain-on-failure',
  },
});
