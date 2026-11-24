import { describe, expect, it } from 'vitest';
import { isSameOrigin, localKeysToRemove } from './deleteRequest';

describe('isSameOrigin', () => {
  it('accepts the origin of the same host', () => {
    expect(isSameOrigin('http://localhost:3006', 'localhost:3006')).toBe(true);
    expect(isSameOrigin('https://App.example.com', 'app.example.com')).toBe(
      true,
    );
  });
  it('refuses a missing, foreign or broken origin', () => {
    expect(isSameOrigin(null, 'localhost:3006')).toBe(false);
    expect(isSameOrigin('https://evil.example', 'localhost:3006')).toBe(false);
    expect(isSameOrigin('http://localhost:3007', 'localhost:3006')).toBe(false);
    expect(isSameOrigin('null', 'localhost:3006')).toBe(false);
    expect(isSameOrigin('http://localhost:3006', null)).toBe(false);
  });
});

describe('localKeysToRemove', () => {
  it("removes this user's cache and the old pre-login keys, nothing else", () => {
    const keys = [
      'diet-app-v1:u:me',
      'diet-app-v1:u:other',
      'diet-app-v1',
      'diet-app-saved-v1',
      'unrelated',
    ];
    expect(localKeysToRemove('me', keys)).toEqual([
      'diet-app-v1:u:me',
      'diet-app-v1',
      'diet-app-saved-v1',
    ]);
  });
});
