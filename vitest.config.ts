import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      Object.entries({
        '@platform/schema': './packages/schema/src/index.ts',
        '@platform/config': './packages/config/src/index.ts',
        '@platform/database': './database/src/index.ts',
        '@platform/cv-engine': './packages/cv-engine/src/index.ts',
      }).map(([name, path]) => [
        name,
        fileURLToPath(new URL(path, import.meta.url)),
      ]),
    ),
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
