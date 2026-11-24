// A stable string for everything that decides the recommendation. When it changes, plan screen state is reset.
import type {
  DietStyle,
  Profile,
  Selection,
  TargetOverrides,
} from '@/types/nutrition';

export type PlanInputs = {
  profile: Profile;
  styles: DietStyle[];
  overrides: TargetOverrides;
  selection: Selection;
  /** Food ids that must be in the day. Absent or empty = no requirement (the fingerprint is then unchanged). */
  includeFoods?: string[];
};

/** JSON with object keys sorted, so key order never changes the result. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, stable(x)]),
    );
  return v;
}

export function requestFingerprint(i: PlanInputs): string {
  const { includeFoods, ...rest } = i;
  return JSON.stringify(
    stable({
      ...rest,
      styles: [...i.styles].sort(),
      // Only added when used, so fingerprints made without it stay the same.
      ...(includeFoods && includeFoods.length > 0
        ? { includeFoods: [...includeFoods].sort() }
        : {}),
    }),
  );
}
