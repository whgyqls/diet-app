// Timing for the account sync (not nutrition numbers, so not in src/lib/nutrition/constants.ts).

/** Edits are collected this long before they are written to the server. */
export const SYNC_DEBOUNCE_MS = 500;

/**
 * A signed-in screen that has not got its account data after this long stops waiting and shows the read-only
 * notice with a retry button, instead of "불러오는 중…" for ever.
 */
export const ACCOUNT_LOAD_TIMEOUT_MS = 15_000;
