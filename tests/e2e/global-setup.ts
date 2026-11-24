// Runs once before the e2e tests: creates ONE throwaway user on the TEST Supabase project, logs it in with a
// password (no mail is sent) and saves the session cookies for every test (use.storageState).
// The user is deleted when the run ends. In 5c the app data is still in localStorage (per browser context),
// so one shared user is enough; from 5d on (server data) each test gets its own user.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTestProject } from '../helpers/testProjectGuard';
import { LOGIN_LOG, STORAGE_STATE, signInCookies } from './helpers/session';

export default async function globalSetup() {
  const project = loadTestProject(); // throws unless this is the marked test project
  mkdirSync(path.dirname(LOGIN_LOG), { recursive: true });
  writeFileSync(LOGIN_LOG, ''); // a new count for this run
  const admin = createClient(project.url, project.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `e2e-${randomBytes(6).toString('hex')}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`e2e createUser: ${error?.message}`);
  const userId = data.user.id;

  try {
    const cookies = await signInCookies(project, email, password);
    mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
    writeFileSync(STORAGE_STATE, JSON.stringify({ cookies, origins: [] }));
  } catch (e) {
    await admin.auth.admin.deleteUser(userId);
    throw e;
  }

  // Tests that need their own session (logout) sign in again with these.
  process.env.E2E_USER_EMAIL = email;
  process.env.E2E_USER_PASSWORD = password;

  return async () => {
    await admin.auth.admin.deleteUser(userId);
  };
}
