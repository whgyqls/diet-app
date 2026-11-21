// Single home for nutrition constants (CLAUDE.md). Phase 2 adds target/portion/scoring constants here.

/** Energy factors (kcal per g) used to sanity-check food data. Fiber counted at 2 kcal/g. */
export const KCAL_PER_GRAM = {
  protein: 4,
  netCarbs: 4,
  fiber: 2,
  fat: 9,
} as const;

/** Allowed relative gap between stated kcal and kcal computed from macros. */
export const KCAL_CHECK_TOLERANCE = 0.2;

/** Food groups whose stated kcal is legitimately below the macro formula (skipped in the kcal check). */
export const KCAL_CHECK_EXCLUDED_GROUPS: readonly string[] = ['버섯'];
