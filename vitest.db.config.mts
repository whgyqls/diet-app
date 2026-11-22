// RLS tests against the Supabase TEST project (tests/db). Not part of `npm test` (that one only runs src/).
// Reads .env.test.local only. tests/helpers/testProjectGuard.ts stops before anything is created unless
// SUPABASE_TEST_PROJECT=1 and the URL is not the production one; without the variables the tests skip.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const envFile = path.resolve(import.meta.dirname, '.env.test.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    // Test users A and B are shared within a run; one file at a time keeps them from racing.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
