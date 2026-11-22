import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    // tests/helpers: pure helpers of the test setup (e.g. the test project guard)
    include: ['src/**/*.test.ts', 'tests/helpers/**/*.test.ts'],
    // A full day plan with everything selected takes a few seconds.
    testTimeout: 60_000,
  },
});
