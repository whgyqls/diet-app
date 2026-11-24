// The claim on this browser's "이전 기록" (the old pre-login localStorage record), PLAN.md 9.2.
// A claim {uid, at} says which account started to load that record. Other accounts on this browser then get no
// button and their code never reads the record. It is a convenience guard on a shared browser, not a security
// boundary (anyone with access to the browser can edit localStorage).
// Pure: callers read and write localStorage themselves.

export const LEGACY_CLAIM_KEY = 'diet-app-legacy-claim-v1';

export type LegacyClaim = { uid: string; at: number };

/** The claim in storage, or null when there is none or it is not the expected JSON (treated as "no claim"). */
export function parseClaim(raw: string | null): LegacyClaim | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const { uid, at } = v as Record<string, unknown>;
    if (typeof uid !== 'string' || uid.length === 0) return null;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return null;
    return { uid, at };
  } catch {
    return null;
  }
}

export const serializeClaim = (c: LegacyClaim) => JSON.stringify(c);

/** 'none' = nobody claimed it, 'mine' = this account did, 'other' = another account did. */
export type ClaimOwner = 'none' | 'mine' | 'other';

export function claimOwner(claim: LegacyClaim | null, uid: string): ClaimOwner {
  if (claim === null) return 'none';
  return claim.uid === uid ? 'mine' : 'other';
}
