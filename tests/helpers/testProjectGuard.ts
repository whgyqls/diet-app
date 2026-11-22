// Stops RLS tests and e2e seeding before they touch a Supabase project that is not the test project.
// Every test helper that creates users or rows must call loadTestProject() first.
//
// Rules (all must hold, otherwise it throws):
// 1. .env.test.local exists and says SUPABASE_TEST_PROJECT=1, and process.env says so too.
// 2. process.env values equal the ones in .env.test.local. process.loadEnvFile does not override variables
//    that are already set, so a production URL or key exported in the shell would otherwise win silently.
// 3. The test URL is not the production URL: .env.local is read from the file (not process.env), and
//    SUPABASE_PROD_URL is compared too when it is set.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

export type TestProject = { url: string; anonKey: string; serviceKey: string };

type Env = Record<string, string | undefined>;

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

/** Origin in lower case ("https://abc.supabase.co/" and "https://ABC.supabase.co" are the same project). */
function originOf(url: string, label: string): string {
  try {
    return new URL(url.trim()).origin.toLowerCase();
  } catch {
    throw new Error(`testProjectGuard: ${label} is not a valid URL`);
  }
}

/**
 * Pure check. `testFile` / `prodFile` are the texts of .env.test.local / .env.local (null = file missing).
 * Returns the test project's settings taken from .env.test.local.
 */
export function checkTestProject(input: {
  env: Env;
  testFile: string | null;
  prodFile: string | null;
}): TestProject {
  const fail = (why: string): never => {
    throw new Error(`testProjectGuard: refusing to run (${why})`);
  };
  if (input.testFile === null) fail('.env.test.local is missing');
  const testEnv = parseEnv(input.testFile ?? '') as Env;

  if (testEnv.SUPABASE_TEST_PROJECT !== '1')
    fail('.env.test.local does not set SUPABASE_TEST_PROJECT=1');
  if (input.env.SUPABASE_TEST_PROJECT !== '1')
    fail('SUPABASE_TEST_PROJECT=1 is not set in the environment');

  for (const key of REQUIRED) {
    const fromFile = testEnv[key];
    if (!fromFile) fail(`${key} is missing in .env.test.local`);
    if (input.env[key] !== fromFile)
      fail(
        `${key} in the environment differs from .env.test.local (set in the shell?)`,
      );
  }

  const testOrigin = originOf(
    testEnv.NEXT_PUBLIC_SUPABASE_URL!,
    'the test URL',
  );
  const prodUrls: [string, string | undefined][] = [
    [
      '.env.local',
      input.prodFile === null
        ? undefined
        : (parseEnv(input.prodFile) as Env).NEXT_PUBLIC_SUPABASE_URL,
    ],
    ['SUPABASE_PROD_URL', input.env.SUPABASE_PROD_URL],
  ];
  for (const [label, prod] of prodUrls)
    if (prod && originOf(prod, label) === testOrigin)
      fail(`the test URL is the production URL from ${label}`);

  return {
    url: testEnv.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: testEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    serviceKey: testEnv.SUPABASE_SERVICE_ROLE_KEY!,
  };
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (name: string) => {
  const file = path.join(ROOT, name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

/** Whether test project settings look present at all (tests skip instead of failing when they are not). */
export function testProjectConfigured(env: Env = process.env): boolean {
  return read('.env.test.local') !== null && env.SUPABASE_TEST_PROJECT === '1';
}

/** Reads both env files from disk and runs the check. Throws before anything is created. */
export function loadTestProject(env: Env = process.env): TestProject {
  return checkTestProject({
    env,
    testFile: read('.env.test.local'),
    prodFile: read('.env.local'),
  });
}
