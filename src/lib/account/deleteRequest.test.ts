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

describe('localKeysToRemove (PLAN.md 9.2)', () => {
  const keys = [
    'diet-app-v1:u:me',
    'diet-app-v1:u:other',
    'diet-app-v1',
    'diet-app-saved-v1',
    'diet-app-legacy-claim-v1',
    'unrelated',
  ];

  it('no claim: my cache and the old record go; the other cache and unrelated keys stay', () => {
    expect(localKeysToRemove('me', keys, null)).toEqual([
      'diet-app-v1:u:me',
      'diet-app-v1',
      'diet-app-saved-v1',
    ]);
  });

  it('my claim: also the claim itself', () => {
    expect(localKeysToRemove('me', keys, { uid: 'me', at: 1 })).toEqual([
      'diet-app-v1:u:me',
      'diet-app-v1',
      'diet-app-saved-v1',
      'diet-app-legacy-claim-v1',
    ]);
  });

  it("another account's claim: only my cache goes; the record and the claim are theirs", () => {
    expect(localKeysToRemove('me', keys, { uid: 'other', at: 1 })).toEqual([
      'diet-app-v1:u:me',
    ]);
  });

  it('a claim key without a matching claim object is not removed on its own (no claim case keeps it)', () => {
    expect(localKeysToRemove('me', ['diet-app-legacy-claim-v1'], null)).toEqual(
      [],
    );
  });
});
