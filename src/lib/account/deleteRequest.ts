// Pure helpers for account deletion (route + button).
import {
  ACCOUNT_CACHE_PREFIX,
  LEGACY_SAVED_KEY,
  LEGACY_STATE_KEY,
} from '@/lib/supabase/cacheOwner';
import {
  LEGACY_CLAIM_KEY,
  claimOwner,
  type LegacyClaim,
} from '@/lib/legacy/legacyClaim';

/**
 * CSRF guard for a cookie-authenticated, state-changing request: the browser always sends Origin on a DELETE,
 * and it must name the host the request was sent to. A missing or foreign Origin is refused.
 */
export function isSameOrigin(
  origin: string | null,
  host: string | null,
): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.trim().toLowerCase();
  } catch {
    return false;
  }
}

/**
 * localStorage keys to remove after the account is deleted (PLAN.md 9.2):
 * - this user's cache is always removed;
 * - the old pre-login record (diet-app-v1, diet-app-saved-v1) and the claim are removed when nobody claimed
 *   the record or this user did;
 * - when ANOTHER account holds the claim, the record and the claim stay: they are that account's.
 */
export function localKeysToRemove(
  uid: string,
  allKeys: string[],
  claim: LegacyClaim | null,
): string[] {
  const owner = claimOwner(claim, uid);
  return allKeys.filter((k) => {
    if (k === `${ACCOUNT_CACHE_PREFIX}${uid}`) return true;
    if (owner === 'other') return false;
    if (k === LEGACY_STATE_KEY || k === LEGACY_SAVED_KEY) return true;
    return k === LEGACY_CLAIM_KEY && owner === 'mine';
  });
}
