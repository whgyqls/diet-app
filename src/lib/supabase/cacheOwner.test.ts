import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CACHE_PREFIX,
  LEGACY_SAVED_KEY,
  LEGACY_STATE_KEY,
  accountCacheKey,
  pickCache,
  staleCacheKeys,
} from './cacheOwner';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const payload = (ownerUid: unknown) =>
  JSON.stringify({ state: { ownerUid, profile: {}, styles: [] }, version: 2 });

describe('pickCache', () => {
  it('uses the cache when the key and the stored owner are the signed-in user', () => {
    expect(pickCache(A, accountCacheKey(A), payload(A))).toEqual({ use: true });
  });

  it("refuses another user's key", () => {
    expect(pickCache(A, accountCacheKey(B), payload(B))).toEqual({
      use: false,
      reason: 'key-mismatch',
    });
  });

  it('refuses the old pre-login keys, so old browser data is never copied into an account', () => {
    for (const key of [LEGACY_STATE_KEY, LEGACY_SAVED_KEY])
      expect(pickCache(A, key, payload(A)), key).toEqual({
        use: false,
        reason: 'key-mismatch',
      });
  });

  it('refuses a right key whose stored owner is someone else, missing or of the wrong type', () => {
    for (const owner of [B, '', undefined, null, 5, { uid: A }])
      expect(
        pickCache(A, accountCacheKey(A), payload(owner)),
        String(owner),
      ).toEqual({
        use: false,
        reason: 'owner-mismatch',
      });
  });

  it('refuses without a session, even for a well-formed cache', () => {
    for (const uid of [null, undefined, ''])
      expect(pickCache(uid, accountCacheKey(A), payload(A))).toEqual({
        use: false,
        reason: 'no-session',
      });
  });

  it('empty and broken values are refused, not thrown', () => {
    const key = accountCacheKey(A);
    expect(pickCache(A, key, null)).toEqual({ use: false, reason: 'empty' });
    expect(pickCache(A, key, '')).toEqual({ use: false, reason: 'empty' });
    for (const bad of [
      '{not json',
      '123',
      '"x"',
      'null',
      '[]',
      '{}',
      '{"state":5}',
      '{"state":[]}',
    ])
      expect(pickCache(A, key, bad), bad).toEqual({
        use: false,
        reason: 'broken',
      });
  });

  it('a hand-made key that only looks similar is refused', () => {
    for (const key of [
      `${accountCacheKey(A)} `,
      `${accountCacheKey(A)}x`,
      accountCacheKey(A).toUpperCase(),
      ACCOUNT_CACHE_PREFIX,
    ])
      expect(pickCache(A, key, payload(A)).use, key).toBe(false);
  });
});

describe('staleCacheKeys', () => {
  const keys = [
    accountCacheKey(A),
    accountCacheKey(B),
    LEGACY_STATE_KEY,
    LEGACY_SAVED_KEY,
    'something-else',
  ];

  it("lists the other users' caches only", () => {
    expect(staleCacheKeys(keys, A)).toEqual([accountCacheKey(B)]);
    expect(staleCacheKeys(keys, B)).toEqual([accountCacheKey(A)]);
  });

  it('lists every account cache when nobody is signed in (after logout)', () => {
    for (const uid of [null, undefined, ''])
      expect(staleCacheKeys(keys, uid)).toEqual([
        accountCacheKey(A),
        accountCacheKey(B),
      ]);
  });

  it('never lists the legacy keys or unrelated keys', () => {
    const stale = staleCacheKeys(keys, null);
    expect(stale).not.toContain(LEGACY_STATE_KEY);
    expect(stale).not.toContain(LEGACY_SAVED_KEY);
    expect(stale).not.toContain('something-else');
  });

  it('nothing to delete when only the own cache exists', () => {
    expect(staleCacheKeys([accountCacheKey(A)], A)).toEqual([]);
    expect(staleCacheKeys([], A)).toEqual([]);
  });
});
