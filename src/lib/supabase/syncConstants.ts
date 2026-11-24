// Timing for the account sync (not nutrition numbers, so not in src/lib/nutrition/constants.ts).

/** Edits are collected this long before they are written to the server. */
export const SYNC_DEBOUNCE_MS = 500;

/**
 * A signed-in screen that has not got its account data after this long stops waiting and shows the read-only
 * notice with a retry button, instead of "불러오는 중…" for ever.
 */
export const ACCOUNT_LOAD_TIMEOUT_MS = 15_000;

// ---- "이전 기록 불러오기" (PLAN.md 9.2) ----------------------------------------------------------------

/**
 * Most ingredient kits / saved (★) combos an account may hold after a restore. The server has no row-count cap;
 * these are only applied when merging the previous record (nothing else enforces them).
 */
export const RESTORE_MAX_KITS = 30;
export const RESTORE_MAX_SAVED = 300;
/** Rows per request when the previous record is written. */
export const RESTORE_WRITE_CHUNK = 50;
/**
 * A jsonb value the table accepts is smaller than 16 KB (pg_column_size < 16384), and the stored jsonb is LARGER
 * than its JSON text. Measured on the test project (2026-11-24) with the shapes the app produces: the saved
 * items/seasonings arrays fail at about 12 KB of text (ratio about 1.4), and arrays of tiny numeric objects
 * fail even at 6 KB. A row is therefore checked against this limit on the JSON text length in bytes, about
 * twice as strict as the measured ratio needs. Real combos are under 2 KB, so only broken or hand-made records
 * are affected (one bad row would make a whole batch insert fail).
 */
export const ROW_JSON_MAX_BYTES = 8_000;
/** Longest saved-combo signature / request fingerprint the table accepts (characters). */
export const SIGNATURE_MAX_CHARS = 1000;
export const FINGERPRINT_MAX_CHARS = 1000;
/** After a restore that ran in one go, it can be taken back for this long (3.2: same as "전체 초기화"). */
export const RESTORE_UNDO_MS = 10_000;
