// Pure helpers for account deletion (route + button).
import { ACCOUNT_CACHE_PREFIX } from '@/lib/supabase/cacheOwner';
import { LEGACY_SAVED_KEY, LEGACY_STATE_KEY } from '@/lib/supabase/cacheOwner';

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

/** localStorage keys to remove after the account is deleted: this user's cache and the old pre-login record. */
export function localKeysToRemove(uid: string, allKeys: string[]): string[] {
  return allKeys.filter(
    (k) =>
      k === `${ACCOUNT_CACHE_PREFIX}${uid}` ||
      k === LEGACY_STATE_KEY ||
      k === LEGACY_SAVED_KEY,
  );
}
