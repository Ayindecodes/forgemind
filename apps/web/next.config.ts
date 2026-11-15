import path from 'node:path';

import type { NextConfig } from 'next';

/*
 * NEXT_OUTPUT=standalone builds what the container image runs: a server with
 * only the files it needs, traced from the workspace root, where the packages
 * this one imports live. Without it the build is the one `next start` serves.
 */
const standalone = process.env.NEXT_OUTPUT === 'standalone';

const nextConfig: NextConfig = {
  transpilePackages: ['@forgemind/contract'],
  ...(standalone && {
    output: 'standalone' as const,
    outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  }),
};

export default nextConfig;
