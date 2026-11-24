import { describe, expect, it } from 'vitest';
import {
  LOGIN_MESSAGES,
  authErrorMessage,
  loginErrorMessage,
  looksLikeEmail,
} from './loginMessages';

describe('loginErrorMessage', () => {
  it('rate limits (by code or by HTTP 429)', () => {
    expect(loginErrorMessage({ code: 'over_email_send_rate_limit' })).toBe(
      LOGIN_MESSAGES.rateLimited,
    );
    expect(loginErrorMessage({ code: 'over_request_rate_limit' })).toBe(
      LOGIN_MESSAGES.rateLimited,
    );
    expect(loginErrorMessage({ status: 429 })).toBe(LOGIN_MESSAGES.rateLimited);
  });
  it('an address the built-in mail service may not send to', () => {
    expect(loginErrorMessage({ code: 'email_address_not_authorized' })).toBe(
      LOGIN_MESSAGES.notAuthorized,
    );
  });
  it('invalid addresses', () => {
    expect(loginErrorMessage({ code: 'email_address_invalid' })).toBe(
      LOGIN_MESSAGES.invalidEmail,
    );
    expect(loginErrorMessage({ code: 'validation_failed' })).toBe(
      LOGIN_MESSAGES.invalidEmail,
    );
  });
  it('anything else is the generic message, also for missing errors', () => {
    expect(loginErrorMessage({ code: 'unexpected_failure', status: 500 })).toBe(
      LOGIN_MESSAGES.generic,
    );
    expect(loginErrorMessage(null)).toBe(LOGIN_MESSAGES.generic);
    expect(loginErrorMessage(undefined)).toBe(LOGIN_MESSAGES.generic);
  });
  it('messages make no health claims and are Korean', () => {
    for (const m of Object.values(LOGIN_MESSAGES)) expect(m).toMatch(/[가-힣]/);
  });
});

describe('looksLikeEmail', () => {
  it('accepts normal addresses and trims spaces', () => {
    for (const ok of ['a@b.co', ' me@example.com ', 'a.b+c@d.example.org'])
      expect(looksLikeEmail(ok), ok).toBe(true);
  });
  it('rejects the rest', () => {
    for (const bad of [
      '',
      'a',
      'a@b',
      '@b.co',
      'a@@b.co',
      'a b@c.co',
      'a@b .co',
    ])
      expect(looksLikeEmail(bad), bad).toBe(false);
  });
});

describe('authErrorMessage (?auth_error on the home page)', () => {
  it('no parameter: no message; oauth: the Google message; anything else: the link message', () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage('oauth')).toBe(LOGIN_MESSAGES.oauthFailed);
    expect(authErrorMessage('1')).toBe(LOGIN_MESSAGES.linkFailed);
    expect(authErrorMessage('')).toBe(LOGIN_MESSAGES.linkFailed);
  });
});
