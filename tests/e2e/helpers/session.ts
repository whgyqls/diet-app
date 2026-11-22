// Logs a test user in without a browser and returns the session cookies in Playwright's format.
// Uses the same @supabase/ssr cookie writer as the app, so the cookie names, encoding and chunking match.
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import type { TestProject } from '../../helpers/testProjectGuard';

/** Cookies of the shared e2e user, written by global-setup and read through `use.storageState`. */
export const STORAGE_STATE = path.resolve(
  process.cwd(),
  'test-results/e2e-auth/state.json',
);

export type PwCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
};

export async function signInCookies(
  project: TestProject,
  email: string,
  password: string,
): Promise<PwCookie[]> {
  const jar = new Map<string, PwCookie>();
  const supabase = createServerClient(project.url, project.anonKey, {
    cookies: {
      getAll: () =>
        [...jar.values()].map(({ name, value }) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          const maxAge = options?.maxAge;
          if (maxAge === 0 || value === '') {
            jar.delete(name);
            continue;
          }
          jar.set(name, {
            name,
            value,
            domain: 'localhost',
            path: options?.path ?? '/',
            expires:
              typeof maxAge === 'number'
                ? Math.floor(Date.now() / 1000) + maxAge
                : -1,
            httpOnly: !!options?.httpOnly,
            secure: false,
            sameSite: 'Lax',
          });
        }
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`e2e sign-in failed: ${error.message}`);
  await supabase.auth.getSession(); // lets pending cookie writes finish
  if (jar.size === 0)
    throw new Error('e2e sign-in produced no session cookies');
  return [...jar.values()];
}
