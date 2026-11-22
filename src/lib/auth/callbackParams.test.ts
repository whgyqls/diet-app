import { describe, expect, it } from 'vitest';
import { resolveCallback } from './callbackParams';

const q = (s: string) => new URLSearchParams(s);

describe('resolveCallback', () => {
  it('token_hash with type=email verifies the OTP', () => {
    expect(resolveCallback(q('token_hash=abc&type=email'))).toEqual({
      kind: 'verify_otp',
      tokenHash: 'abc',
      next: '/select',
    });
  });

  it('a code exchanges the PKCE code', () => {
    expect(resolveCallback(q('code=xyz'))).toEqual({
      kind: 'exchange_code',
      code: 'xyz',
      next: '/select',
    });
  });

  it('refuses a token_hash with another type, or without a type', () => {
    for (const s of [
      'token_hash=abc&type=recovery',
      'token_hash=abc&type=invite',
      'token_hash=abc&type=magiclink',
      'token_hash=abc',
    ])
      expect(resolveCallback(q(s)), s).toEqual({ kind: 'invalid' });
  });

  it('a token_hash wins over a code, and a bad type is not rescued by a code', () => {
    expect(resolveCallback(q('token_hash=abc&type=email&code=xyz')).kind).toBe(
      'verify_otp',
    );
    expect(
      resolveCallback(q('token_hash=abc&type=recovery&code=xyz')).kind,
    ).toBe('invalid');
  });

  it('is invalid without anything usable', () => {
    for (const s of ['', 'type=email', 'next=/plan', 'code=', 'token_hash='])
      expect(resolveCallback(q(s)), s).toEqual({ kind: 'invalid' });
  });

  it('keeps an internal next and drops an unsafe one', () => {
    expect(resolveCallback(q('code=x&next=/plan'))).toMatchObject({
      next: '/plan',
    });
    expect(resolveCallback(q('code=x&next=//evil.com'))).toMatchObject({
      next: '/select',
    });
    expect(
      resolveCallback(q('token_hash=a&type=email&next=https://evil.com')),
    ).toMatchObject({ next: '/select' });
  });
});
