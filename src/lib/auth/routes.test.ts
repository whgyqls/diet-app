import { describe, expect, it } from 'vitest';
import { isProtectedPath, loginRedirectFor } from './routes';

describe('isProtectedPath', () => {
  it('protects the app pages and their sub paths', () => {
    for (const p of [
      '/onboarding',
      '/select',
      '/plan',
      '/saved',
      '/settings',
      '/plan/',
      '/select/anything',
    ])
      expect(isProtectedPath(p), p).toBe(true);
  });

  it('leaves the home page, the auth routes, the API and static files open', () => {
    for (const p of [
      '/',
      '/auth/callback',
      '/privacy',
      '/api/explain',
      '/favicon.ico',
      '/planet',
      '/selection',
      '/manifest.json',
    ])
      expect(isProtectedPath(p), p).toBe(false);
  });

  it('is not fooled by encoding, case or repeated slashes', () => {
    for (const p of [
      '/%73elect',
      '/SELECT',
      '/Plan',
      '//select',
      '/plan//',
      '/sel%65ct',
      '/%2Fselect',
      '/\\select',
    ])
      expect(isProtectedPath(p), p).toBe(true);
  });

  it('treats a malformed encoding as the raw path', () => {
    expect(isProtectedPath('/select%')).toBe(false);
    expect(isProtectedPath('/%E0%A4%A')).toBe(false);
  });
});

describe('loginRedirectFor', () => {
  it('sends a signed-out visitor of a protected page to the home page', () => {
    expect(loginRedirectFor('/select', false)).toBe('/');
    expect(loginRedirectFor('/%73aved', false)).toBe('/');
  });
  it('lets signed-in users through, and signed-out users on open pages', () => {
    expect(loginRedirectFor('/select', true)).toBeNull();
    expect(loginRedirectFor('/', false)).toBeNull();
    expect(loginRedirectFor('/auth/callback', false)).toBeNull();
  });
});
