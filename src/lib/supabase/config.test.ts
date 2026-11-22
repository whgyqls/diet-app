import { describe, expect, it } from 'vitest';
import { checkSupabaseEnv } from './config';

const URL_OK = 'https://abcref.supabase.co';

describe('checkSupabaseEnv', () => {
  it('accepts the project URL, with or without a trailing slash, and returns its origin', () => {
    expect(checkSupabaseEnv(URL_OK, 'key')).toEqual({
      url: URL_OK,
      anonKey: 'key',
    });
    expect(checkSupabaseEnv(`${URL_OK}/`, 'key').url).toBe(URL_OK);
    expect(checkSupabaseEnv(` ${URL_OK} `, 'key').url).toBe(URL_OK);
  });

  it('rejects a URL with a path (the REST endpoint copied by mistake), a query or a hash', () => {
    for (const u of [
      `${URL_OK}/rest/v1/`,
      `${URL_OK}/rest/v1`,
      `${URL_OK}/auth/v1`,
      `${URL_OK}/?x=1`,
      `${URL_OK}/#a`,
    ])
      expect(() => checkSupabaseEnv(u, 'key'), u).toThrow(/without a path/);
  });

  it('rejects missing values and invalid URLs', () => {
    expect(() => checkSupabaseEnv(undefined, 'key')).toThrow(/not configured/);
    expect(() => checkSupabaseEnv(URL_OK, '')).toThrow(/not configured/);
    expect(() => checkSupabaseEnv('not a url', 'key')).toThrow(
      /not a valid URL/,
    );
  });
});
