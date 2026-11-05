import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(here, '../app/src'),
      '@': path.resolve(here, 'src'),
    },
  },
  define: { __DEV__: 'false' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
