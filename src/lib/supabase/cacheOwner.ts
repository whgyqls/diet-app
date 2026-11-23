// The browser keeps a per-user copy of the account data (zustand persist) so the first screen is quick.
// It is only a cache: it must belong to the signed-in user, and the old pre-login keys must never be read as
// one (that would silently copy an old browser's data into a new account, see PLAN.md 9.2).
// Pure: the caller removes what these functions refuse.

/** Per-user cache key: `diet-app-v1:u:<uid>`. */
export const ACCOUNT_CACHE_PREFIX = 'diet-app-v1:u:';
/** The pre-login keys. Not account caches; only the "이전 기록 불러오기" restore reads them (Phase 5e). */
export const LEGACY_STATE_KEY = 'diet-app-v1';
export const LEGACY_SAVED_KEY = 'diet-app-saved-v1';

export const accountCacheKey = (uid: string) => `${ACCOUNT_CACHE_PREFIX}${uid}`;

export type CacheDecision =
  | { use: true }
  | {
      use: false;
      reason:
        | 'no-session' // nobody is signed in
        | 'key-mismatch' // the key is not this user's (other user, or an old pre-login key)
        | 'empty' // nothing stored
        | 'broken' // not the expected JSON
        | 'owner-mismatch'; // the key is right but the value says another user (or nobody) owns it
    };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * May the stored value under `key` be used as the cache of the user `sessionUid`?
 * The persist payload is `{ state: { ownerUid, ... }, version }`; both the key and the stored `ownerUid`
 * must name the signed-in user.
 */
export function pickCache(
  sessionUid: string | null | undefined,
  key: string,
  raw: string | null,
): CacheDecision {
  if (!sessionUid) return { use: false, reason: 'no-session' };
  if (key !== accountCacheKey(sessionUid))
    return { use: false, reason: 'key-mismatch' };
  if (raw === null || raw === '') return { use: false, reason: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { use: false, reason: 'broken' };
  }
  if (!isRecord(parsed) || !isRecord(parsed.state))
    return { use: false, reason: 'broken' };
  if (parsed.state.ownerUid !== sessionUid)
    return { use: false, reason: 'owner-mismatch' };
  return { use: true };
}

/**
 * Account cache keys to delete: every per-user cache except the signed-in user's own (everything when nobody
 * is signed in, e.g. after logout). The legacy keys are never listed.
 */
export function staleCacheKeys(
  allKeys: readonly string[],
  currentUid: string | null | undefined,
): string[] {
  const keep = currentUid ? accountCacheKey(currentUid) : null;
  return allKeys.filter(
    (k) => k.startsWith(ACCOUNT_CACHE_PREFIX) && k !== keep,
  );
}
