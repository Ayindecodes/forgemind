import type { PlaywrightTestConfig } from '@playwright/test';

/*
 * Settings both Playwright configs share: the ports no other service on this
 * machine uses, the signed-in state, and the two servers every suite needs.
 */

export const webPort = 3110;
export const apiPort = 4110;
export const webUrl = `http://localhost:${webPort}`;
export const apiUrl = `http://localhost:${apiPort}`;

/** The seeded owner's session, through a fixed dev-only token. */
export const ownerCookie = {
  name: 'fm_session',
  value: 'dev-owner',
  domain: 'localhost',
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: false,
  sameSite: 'Lax' as const,
};

export const ownerState = { cookies: [ownerCookie], origins: [] };

/**
 * The dev API and the production build of the web app. `apiSpeed` is the
 * scenario playback speed: 1 is real time, 'Infinity' plays every run to its
 * end the moment it starts.
 */
export const webServers = (options: {
  apiSpeed: '1' | 'Infinity';
  reuse: boolean;
}): NonNullable<PlaywrightTestConfig['webServer']> => [
  {
    command: 'pnpm --filter @forgemind/dev-api start',
    url: `${apiUrl}/health`,
    env: {
      PORT: String(apiPort),
      WEB_ORIGIN: webUrl,
      DEV_API_ORIGIN: apiUrl,
      DEV_API_SPEED: options.apiSpeed,
    },
    reuseExistingServer: options.reuse,
  },
  {
    command: `pnpm build && pnpm start --port ${webPort}`,
    url: webUrl,
    env: { ENABLE_DESIGN_PAGE: '1', NEXT_PUBLIC_API_URL: apiUrl },
    timeout: 180_000,
    reuseExistingServer: options.reuse,
  },
];
