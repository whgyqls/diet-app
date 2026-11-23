// What has to be written to the server? Compares the state the server is known to have (`lastSynced`) with the
// current state. Pure.
//
// Writes are driven by this difference, not by "something changed" events: a value that was just loaded from
// the server equals `lastSynced`, so it produces no operations and is never written back (no echo), and an
// older cache that was replaced by the server's values cannot overwrite the server.
import type { IngredientKit } from '@/lib/kits/kits';
import type {
  DietStyle,
  Profile,
  Selection,
  TargetOverrides,
} from '@/types/nutrition';

/** The parts of the app state that live on the server. `step` and other screen state are not in it. */
export type SyncState = {
  profile: Partial<Profile>;
  styles: DietStyle[];
  overrides: TargetOverrides;
  selection: Selection;
  kits: IngredientKit[];
};

export type SyncOps = {
  /** profiles row: profile fields, styles or overrides changed. */
  settings: boolean;
  /** food_prefs: the selection changed (written whole through set_food_prefs). */
  selection: boolean;
  kitsAdded: IngredientKit[];
  /** Same id, other name / selection / styles. Timestamps alone do not count (the database sets them). */
  kitsUpdated: IngredientKit[];
  kitsDeleted: string[];
};
// Apply the kit operations in this order: delete, update, add. A name freed by a delete or a rename can then be
// taken in the same round without breaking UNIQUE(user_id, name).

export const NO_SYNC_OPS: SyncOps = Object.freeze({
  settings: false,
  selection: false,
  kitsAdded: [],
  kitsUpdated: [],
  kitsDeleted: [],
}) as SyncOps;

export function hasSyncOps(ops: SyncOps): boolean {
  return (
    ops.settings ||
    ops.selection ||
    ops.kitsAdded.length > 0 ||
    ops.kitsUpdated.length > 0 ||
    ops.kitsDeleted.length > 0
  );
}

/** Picks the synced parts out of the whole app state (anything else, `step`, actions, is dropped). */
export function toSyncState(s: SyncState): SyncState {
  return {
    profile: s.profile,
    styles: s.styles,
    overrides: s.overrides,
    selection: s.selection,
    kits: s.kits,
  };
}

/** An independent copy, for keeping as `lastSynced` (later changes to the live state cannot reach it). */
export function cloneSyncState(s: SyncState): SyncState {
  return structuredClone(toSyncState(s));
}

/** Deep equality; a key whose value is undefined counts as missing. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  )
    return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(rb, k) && deepEqual(ra[k], rb[k]),
  );
}

/** The order of the chosen styles does not matter. */
const sameStyles = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  a.every((s) => b.includes(s)) &&
  b.every((s) => a.includes(s));

const kitContent = (k: IngredientKit) => ({
  name: k.name,
  selection: k.selection,
  styles: k.styles, // undefined = "styles not saved with this kit", different from []
});

export function diffForSync(last: SyncState, current: SyncState): SyncOps {
  const settings =
    !deepEqual(last.profile, current.profile) ||
    !sameStyles(last.styles, current.styles) ||
    !deepEqual(last.overrides, current.overrides);
  const selection = !deepEqual(last.selection, current.selection);

  const before = new Map(last.kits.map((k) => [k.id, k]));
  const now = new Map(current.kits.map((k) => [k.id, k]));
  const kitsAdded = current.kits.filter((k) => !before.has(k.id));
  const kitsDeleted = last.kits.filter((k) => !now.has(k.id)).map((k) => k.id);
  const kitsUpdated = current.kits.filter((k) => {
    const old = before.get(k.id);
    return old !== undefined && !deepEqual(kitContent(old), kitContent(k));
  });

  return { settings, selection, kitsAdded, kitsUpdated, kitsDeleted };
}
