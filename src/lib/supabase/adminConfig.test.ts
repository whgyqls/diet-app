import { describe, expect, it } from 'vitest';
import { checkAdminEnv } from './adminConfig';

const jwt = (ref: string) =>
  `h.${Buffer.from(JSON.stringify({ ref, role: 'service_role' })).toString('base64url')}.s`;

describe('checkAdminEnv', () => {
  const url = 'https://abcdef.supabase.co';
  it('throws without a key', () => {
    expect(() => checkAdminEnv(url, undefined)).toThrow(/not configured/);
    expect(() => checkAdminEnv(url, '  ')).toThrow(/not configured/);
  });
  it('accepts a key of the same project', () => {
    expect(checkAdminEnv(url, jwt('abcdef'))).toBe(jwt('abcdef'));
  });
  it('refuses a key of another project', () => {
    expect(() => checkAdminEnv(url, jwt('zzzzzz'))).toThrow(
      /different Supabase project/,
    );
  });
  it('passes keys that name no project (opaque keys, other hosts)', () => {
    expect(checkAdminEnv(url, 'sb_secret_x')).toBe('sb_secret_x');
    expect(checkAdminEnv('http://localhost:54321', jwt('abcdef'))).toBe(
      jwt('abcdef'),
    );
  });
});
