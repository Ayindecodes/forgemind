import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  globalIgnores([
    '**/.next/**',
    '**/coverage/**',
    '**/dist/**',
    '**/next-env.d.ts',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/.venv/**',
  ]),
  ...nextVitals,
  ...nextTypescript,
  {
    settings: {
      next: { rootDir: 'apps/web' },
      react: { version: '19' },
    },
  },
  prettier,
]);
