import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './tests/e2e/helpers/session';
import { loadTestProject } from './tests/helpers/testProjectGuard';

const PORT = 3006;

// e2e runs against the TEST Supabase project only. process.loadEnvFile does not override variables that are
// already set, and the guard compares them with .env.test.local, so a production value exported in the shell
// stops the run here, before any server starts or any user is created.
const envFile = path.resolve(__dirname, '.env.test.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const project = loadTestProject();

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: `http://localhost:${PORT}`, storageState: STORAGE_STATE },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    // Always a fresh server: one that is already running may use the production keys from .env.local.
    reuseExistingServer: false,
    // Next.js does not override variables that are already set, so these win over .env.local.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: project.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: project.anonKey,
    },
  },
});
