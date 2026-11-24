// What "이전 기록 불러오기" would change, as plain data (PLAN.md 9.2). Pure.
// One function decides everything: the confirm dialog shows its counts and the runner writes exactly its
// result, so the dialog and the writes cannot disagree.
//
// Rules (only parts where the previous record HAS a value change anything):
// - profile: field by field, a field the record has overrides the account's; fields the record lacks stay.
// - styles / goal overrides: replaced when the record has some.
// - selection: foods and seasonings are judged separately; a side that is empty in the record is left alone.
// - kits: added by name (an existing name keeps the account's kit); ★: added by signature.
// - kits and ★ stop at a cap for the merged result, newest first (RESTORE_MAX_*).
import type { IngredientKit } from '@/lib/kits/kits';
import type { SavedCombo } from '@/lib/plan/savedCombos';
import {
  RESTORE_MAX_KITS,
  RESTORE_MAX_SAVED,
} from '@/lib/supabase/syncConstants';
import type {
  DietStyle,
  Profile,
  Selection,
  TargetOverrides,
} from '@/types/nutrition';
import type { LegacyRecord } from './readLegacy';

export type AccountData = {
  profile: Partial<Profile>;
  styles: DietStyle[];
  overrides: TargetOverrides;
  selection: Selection;
  kits: IngredientKit[];
  /** Signatures of the account's ★ (the restore skips these). */
  savedSignatures: ReadonlySet<string>;
};

export type RestorePlan = {
  /** The settings after the restore (profile fields, styles, overrides); null = nothing in them changes. */
  settings: {
    profile: Partial<Profile>;
    styles: DietStyle[];
    overrides: TargetOverrides;
  } | null;
  /** The whole selection to write; null = leave it alone. */
  selection: Selection | null;
  kits: IngredientKit[];
  saved: SavedCombo[];
  skipped: {
    kitsExisting: number;
    kitsOverCap: number;
    savedExisting: number;
    savedOverCap: number;
  };
  /** Values of the record that replace a DIFFERENT, non-empty value of the account (what the dialog warns about). */
  overwrite: {
    profileFields: number;
    styles: boolean;
    overrides: boolean;
    foods: number; // how many foods the record's selection has, when it replaces the account's
    seasonings: number;
  };
  needsConfirm: boolean;
  add: { kits: number; saved: number };
  hasChanges: boolean;
};

/** JSON with sorted keys: two values with the same content give the same text. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object' && v !== null)
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  return JSON.stringify(v);
}
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

const nonEmpty = (o: object) => Object.keys(o).length > 0;

/** Kits newest first by updatedAt, ties by name, so the cap keeps the most recent ones. */
const newestKits = (a: IngredientKit, b: IngredientKit) =>
  b.updatedAt - a.updatedAt || a.name.localeCompare(b.name);
const newestSaved = (a: SavedCombo, b: SavedCombo) =>
  b.savedAt - a.savedAt || a.signature.localeCompare(b.signature);

export function planRestore(
  legacy: LegacyRecord,
  account: AccountData,
): RestorePlan {
  // ---- profile fields ----
  const profile: Partial<Profile> = { ...account.profile };
  let profileFieldsOverwritten = 0;
  let profileChanged = false;
  for (const key of Object.keys(legacy.profile) as (keyof Profile)[]) {
    const value = legacy.profile[key];
    if (value === undefined) continue;
    const current = account.profile[key];
    if (current === value) continue;
    if (current !== undefined) profileFieldsOverwritten += 1;
    (profile as Record<string, unknown>)[key] = value;
    profileChanged = true;
  }

  // ---- styles, overrides ----
  const stylesChange =
    legacy.styles.length > 0 && !sameSet(legacy.styles, account.styles);
  const stylesOverwrite = stylesChange && account.styles.length > 0;
  const overridesChange =
    nonEmpty(legacy.overrides) &&
    stable(legacy.overrides) !== stable(account.overrides);
  const overridesOverwrite = overridesChange && nonEmpty(account.overrides);

  // ---- selection: each side on its own ----
  const foodsChange =
    nonEmpty(legacy.selection.foods) &&
    stable(legacy.selection.foods) !== stable(account.selection.foods);
  const seasoningsChange =
    nonEmpty(legacy.selection.seasonings) &&
    stable(legacy.selection.seasonings) !==
      stable(account.selection.seasonings);
  const selection: Selection | null =
    foodsChange || seasoningsChange
      ? {
          foods: foodsChange
            ? { ...legacy.selection.foods }
            : { ...account.selection.foods },
          seasonings: seasoningsChange
            ? { ...legacy.selection.seasonings }
            : { ...account.selection.seasonings },
        }
      : null;
  const foodsOverwrite = foodsChange && nonEmpty(account.selection.foods);
  const seasoningsOverwrite =
    seasoningsChange && nonEmpty(account.selection.seasonings);

  // ---- kits: by name, then the cap ----
  const accountNames = new Set(account.kits.map((k) => k.name));
  const kitsNew = legacy.kits.filter((k) => !accountNames.has(k.name));
  const kitsExisting = legacy.kits.length - kitsNew.length;
  const kitRoom = Math.max(0, RESTORE_MAX_KITS - account.kits.length);
  const kits = [...kitsNew].sort(newestKits).slice(0, kitRoom);

  // ---- ★: by signature (two with one signature: the newest), then the cap ----
  const bySignature = new Map<string, SavedCombo>();
  for (const s of legacy.saved) {
    const seen = bySignature.get(s.signature);
    if (!seen || s.savedAt > seen.savedAt) bySignature.set(s.signature, s);
  }
  const savedUnique = [...bySignature.values()];
  const savedNew = savedUnique.filter(
    (s) => !account.savedSignatures.has(s.signature),
  );
  // legacy duplicates among themselves count as "already there" too
  const savedExisting = legacy.saved.length - savedNew.length;
  const savedRoom = Math.max(
    0,
    RESTORE_MAX_SAVED - account.savedSignatures.size,
  );
  const saved = [...savedNew].sort(newestSaved).slice(0, savedRoom);

  const settingsChanged = profileChanged || stylesChange || overridesChange;
  const overwrite = {
    profileFields: profileFieldsOverwritten,
    styles: stylesOverwrite,
    overrides: overridesOverwrite,
    foods: foodsOverwrite ? Object.keys(legacy.selection.foods).length : 0,
    seasonings: seasoningsOverwrite
      ? Object.keys(legacy.selection.seasonings).length
      : 0,
  };
  return {
    settings: settingsChanged
      ? {
          profile,
          styles: stylesChange ? [...legacy.styles] : [...account.styles],
          overrides: overridesChange
            ? { ...legacy.overrides }
            : { ...account.overrides },
        }
      : null,
    selection,
    kits,
    saved,
    skipped: {
      kitsExisting,
      kitsOverCap: kitsNew.length - kits.length,
      savedExisting,
      savedOverCap: savedNew.length - saved.length,
    },
    overwrite,
    needsConfirm:
      overwrite.profileFields > 0 ||
      overwrite.styles ||
      overwrite.overrides ||
      overwrite.foods > 0 ||
      overwrite.seasonings > 0,
    add: { kits: kits.length, saved: saved.length },
    hasChanges:
      settingsChanged ||
      selection !== null ||
      kits.length > 0 ||
      saved.length > 0,
  };
}
