/* eslint-disable react-hooks/rules-of-hooks -- `use` here is Playwright's fixture callback, not a React hook */
// `test` for specs that use the app's data. One test user per Playwright worker (so a run makes only a handful
// of password logins), and before every test that user's server data is deleted, so each test starts from a
// new, empty account. Specs that do not touch account data (smoke, auth) keep using @playwright/test.
import { randomBytes } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import { signInCookies, type PwCookie } from './helpers/session';
import {
  registerUser,
  resetUserData,
  setActiveUser,
  testAdmin,
  unregisterUser,
} from './helpers/seed';
import { loadTestProject } from '../helpers/testProjectGuard';

export type WorkerUser = { id: string; cookies: PwCookie[] };

export const test = base.extend<
  { cleanServerData: void },
  { workerUser: WorkerUser }
>({
  workerUser: [
    async ({}, use, workerInfo) => {
      const project = loadTestProject(); // throws unless this is the marked test project
      const admin = testAdmin();
      const email = `e2e-w${workerInfo.parallelIndex}-${randomBytes(5).toString('hex')}@example.com`;
      const password = randomBytes(24).toString('base64url');
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error || !created.data.user)
        throw new Error(`e2e createUser: ${created.error?.message}`);
      const id = created.data.user.id;
      registerUser(id);
      try {
        const cookies = await signInCookies(project, email, password); // the only login of this worker
        await use({ id, cookies });
      } finally {
        unregisterUser(id);
        await admin.auth.admin.deleteUser(id);
      }
    },
    { scope: 'worker' },
  ],

  // every test of the worker runs as the worker's user
  storageState: async ({ workerUser }, use) => {
    await use({ cookies: workerUser.cookies, origins: [] });
  },

  cleanServerData: [
    async ({ workerUser }, use) => {
      setActiveUser(workerUser.id);
      await resetUserData(workerUser.id);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
