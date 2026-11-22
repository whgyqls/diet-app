import { describe, expect, it } from 'vitest';
import { checkTestProject } from './testProjectGuard';

const TEST_URL = 'https://testref.supabase.co';
const PROD_URL = 'https://prodref.supabase.co';
const testFile = (url = TEST_URL, flag = 'SUPABASE_TEST_PROJECT=1') =>
  [
    flag,
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon',
    'SUPABASE_SERVICE_ROLE_KEY=test-service',
  ].join('\n');
const env = (over: Record<string, string | undefined> = {}) => ({
  SUPABASE_TEST_PROJECT: '1',
  NEXT_PUBLIC_SUPABASE_URL: TEST_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  ...over,
});
const prodFile = `NEXT_PUBLIC_SUPABASE_URL=${PROD_URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=prod-anon\n`;

describe('checkTestProject', () => {
  it('passes for a marked test project that is not production, and returns the file values', () => {
    expect(
      checkTestProject({ env: env(), testFile: testFile(), prodFile }),
    ).toEqual({
      url: TEST_URL,
      anonKey: 'test-anon',
      serviceKey: 'test-service',
    });
  });

  it('passes when .env.local does not exist', () => {
    expect(() =>
      checkTestProject({ env: env(), testFile: testFile(), prodFile: null }),
    ).not.toThrow();
  });

  it('stops without .env.test.local', () => {
    expect(() =>
      checkTestProject({ env: env(), testFile: null, prodFile }),
    ).toThrow(/\.env\.test\.local is missing/);
  });

  it('stops without the marker, in the file or in the environment', () => {
    expect(() =>
      checkTestProject({
        env: env(),
        testFile: testFile(TEST_URL, ''),
        prodFile,
      }),
    ).toThrow(/SUPABASE_TEST_PROJECT=1/);
    expect(() =>
      checkTestProject({
        env: env(),
        testFile: testFile(TEST_URL, 'SUPABASE_TEST_PROJECT=true'),
        prodFile,
      }),
    ).toThrow(/SUPABASE_TEST_PROJECT=1/);
    expect(() =>
      checkTestProject({
        env: env({ SUPABASE_TEST_PROJECT: undefined }),
        testFile: testFile(),
        prodFile,
      }),
    ).toThrow(/in the environment/);
  });

  it('stops when the test URL is the production URL from .env.local (case and trailing slash ignored)', () => {
    for (const url of [
      PROD_URL,
      'https://PRODREF.supabase.co/',
      `${PROD_URL}/rest/v1`,
    ])
      expect(() =>
        checkTestProject({
          env: env({ NEXT_PUBLIC_SUPABASE_URL: url }),
          testFile: testFile(url),
          prodFile,
        }),
      ).toThrow(/production URL from \.env\.local/);
  });

  it('stops when the test URL equals SUPABASE_PROD_URL', () => {
    expect(() =>
      checkTestProject({
        env: env({ SUPABASE_PROD_URL: TEST_URL }),
        testFile: testFile(),
        prodFile: null,
      }),
    ).toThrow(/SUPABASE_PROD_URL/);
  });

  it('stops when the environment differs from .env.test.local (a value exported in the shell wins over loadEnvFile)', () => {
    for (const over of [
      { NEXT_PUBLIC_SUPABASE_URL: PROD_URL },
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'prod-anon' },
      { SUPABASE_SERVICE_ROLE_KEY: 'prod-service' },
      { SUPABASE_SERVICE_ROLE_KEY: undefined },
    ])
      expect(() =>
        checkTestProject({ env: env(over), testFile: testFile(), prodFile }),
      ).toThrow(/differs from \.env\.test\.local/);
  });

  it('stops when the URL has a path (the REST endpoint copied instead of the project URL)', () => {
    for (const url of [
      `${TEST_URL}/rest/v1/`,
      `${TEST_URL}/rest/v1`,
      `${TEST_URL}/auth/v1`,
    ])
      expect(() =>
        checkTestProject({
          env: env({ NEXT_PUBLIC_SUPABASE_URL: url }),
          testFile: testFile(url),
          prodFile,
        }),
      ).toThrow(/without a path/);
    expect(() =>
      checkTestProject({
        env: env({ NEXT_PUBLIC_SUPABASE_URL: `${TEST_URL}/` }),
        testFile: testFile(`${TEST_URL}/`),
        prodFile,
      }),
    ).not.toThrow();
  });

  it('stops when a value is missing in .env.test.local, or the URL is not a URL', () => {
    expect(() =>
      checkTestProject({
        env: env(),
        testFile:
          'SUPABASE_TEST_PROJECT=1\nNEXT_PUBLIC_SUPABASE_URL=https://testref.supabase.co',
        prodFile,
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY is missing/);
    expect(() =>
      checkTestProject({
        env: env({ NEXT_PUBLIC_SUPABASE_URL: 'not a url' }),
        testFile: testFile('not a url'),
        prodFile,
      }),
    ).toThrow(/not a valid URL/);
  });
});
