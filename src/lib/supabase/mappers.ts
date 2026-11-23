// DB rows <-> app types. Pure functions; column names follow the draft schema in the Phase 5 plan
// (supabase/migrations/0001_init.sql comes in 5b, after the schema is approved).
// Reads never trust the server: rows go through src/lib/validate, bad rows and fields are dropped.
import type { IngredientKit } from '@/lib/kits/kits';
import type { SavedCombo } from '@/lib/plan/savedCombos';
import { sanitizePartialProfile } from '@/lib/profile';
import {
  isNonNegative,
  isPrefStatus,
  isRecord,
  sanitizeKit,
  sanitizeOverrides,
  sanitizeSavedCombo,
  sanitizeStyles,
  type KnownItemIds,
} from '@/lib/validate/validate';
import type {
  DietStyle,
  PrefStatus,
  Profile,
  Selection,
  TargetOverrides,
} from '@/types/nutrition';

const toMs = (v: unknown): number | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
};
const toIso = (ms: number) => new Date(ms).toISOString();

// ---- profiles -------------------------------------------------------------------------------------

export type ProfileRow = {
  id: string;
  sex: string | null;
  birth_year: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: number | null;
  goal: string | null;
  meals_per_day: number | null;
  styles: string[] | null;
  custom_targets: unknown;
  legacy_imported_at: string | null;
};

/** What the app keeps in its store for the account (profile, styles, overrides). */
export type AccountSettings = {
  profile: Partial<Profile>;
  styles: DietStyle[];
  overrides: TargetOverrides;
};

export function profileRowToSettings(
  row: Partial<ProfileRow> | null | undefined,
): AccountSettings & { legacyImportedAt: number | null } {
  const r = row ?? {};
  return {
    profile: sanitizePartialProfile({
      sex: r.sex,
      birthYear: r.birth_year,
      heightCm: r.height_cm,
      weightKg: r.weight_kg,
      activityLevel: r.activity_level,
      goal: r.goal,
      mealsPerDay: r.meals_per_day,
    }),
    styles: sanitizeStyles(r.styles),
    overrides: sanitizeOverrides(r.custom_targets),
    legacyImportedAt: toMs(r.legacy_imported_at) ?? null,
  };
}

/**
 * Upsert payload. Missing profile fields are null. Only fields that pass the app's own validation are written:
 * the onboarding form puts every keystroke into the store ("19" on the way to "1996"), and the table's checks
 * would refuse those values and the failed write would then undo what the person is typing.
 * legacy_imported_at is written separately (restore flow).
 */
export function settingsToProfileRow(
  uid: string,
  s: AccountSettings,
): Omit<ProfileRow, 'legacy_imported_at'> {
  const p = sanitizePartialProfile(s.profile);
  return {
    id: uid,
    sex: p.sex ?? null,
    birth_year: p.birthYear ?? null,
    height_cm: p.heightCm ?? null,
    weight_kg: p.weightKg ?? null,
    activity_level: p.activityLevel ?? null,
    goal: p.goal ?? null,
    meals_per_day: p.mealsPerDay ?? null,
    styles: sanitizeStyles(s.styles),
    custom_targets:
      Object.keys(sanitizeOverrides(s.overrides)).length > 0
        ? sanitizeOverrides(s.overrides)
        : null,
  };
}

// ---- food_prefs -----------------------------------------------------------------------------------

export type FoodPrefRow = { item_id: string; kind: string; status: string };

/** Rows -> Selection. A row is dropped when its id is unknown, its kind does not match the id, or its status is bad. */
export function foodPrefRowsToSelection(
  rows: readonly Partial<FoodPrefRow>[] | null | undefined,
  known: KnownItemIds,
): Selection {
  const foods: Record<string, PrefStatus> = {};
  const seasonings: Record<string, PrefStatus> = {};
  for (const row of rows ?? []) {
    if (!isRecord(row) || typeof row.item_id !== 'string') continue;
    if (!isPrefStatus(row.status)) continue;
    if (row.kind === 'food' && known.foods.has(row.item_id))
      foods[row.item_id] = row.status;
    else if (row.kind === 'seasoning' && known.seasonings.has(row.item_id))
      seasonings[row.item_id] = row.status;
  }
  return { foods, seasonings };
}

/** Arguments of the set_food_prefs function (copies, so the store's objects are never shared). */
export function selectionToRpcArgs(sel: Selection): {
  p_foods: Record<string, PrefStatus>;
  p_seasonings: Record<string, PrefStatus>;
} {
  return { p_foods: { ...sel.foods }, p_seasonings: { ...sel.seasonings } };
}

// ---- ingredient_kits ------------------------------------------------------------------------------

export type KitRow = {
  id: string;
  name: string;
  selection: unknown;
  styles: string[] | null;
  created_at: string;
  updated_at: string;
};

export function kitRowToKit(
  row: Partial<KitRow> | null | undefined,
  known: KnownItemIds,
): IngredientKit | undefined {
  if (!isRecord(row)) return undefined;
  return sanitizeKit(
    {
      id: row.id,
      name: row.name,
      selection: row.selection,
      // null in the column = "styles not saved with this kit"
      styles: row.styles ?? undefined,
      createdAt: toMs(row.created_at),
      updatedAt: toMs(row.updated_at),
    },
    known,
  );
}

/** Insert payload. The id is generated by the client (a uuid; 5d) so optimistic updates keep their identity. */
export function kitToInsertRow(uid: string, kit: IngredientKit) {
  return {
    id: kit.id,
    user_id: uid,
    name: kit.name,
    selection: {
      foods: { ...kit.selection.foods },
      seasonings: { ...kit.selection.seasonings },
    },
    styles: kit.styles ? [...kit.styles] : null,
    created_at: toIso(kit.createdAt),
  };
}

// ---- saved_combos ---------------------------------------------------------------------------------

export type SavedComboRow = {
  id: string;
  meal_type: string;
  signature: string;
  request_fingerprint: string;
  items: unknown;
  oils: unknown;
  seasonings: unknown;
  totals: unknown;
  created_at: string;
};

export function savedRowToCombo(
  row: Partial<SavedComboRow> | null | undefined,
  known: KnownItemIds,
): SavedCombo | undefined {
  if (!isRecord(row)) return undefined;
  const savedAt = toMs(row.created_at);
  if (!isNonNegative(savedAt)) return undefined;
  return sanitizeSavedCombo(
    {
      id: row.id,
      savedAt,
      mealType: row.meal_type,
      requestFingerprint: row.request_fingerprint,
      signature: row.signature,
      items: row.items,
      oils: row.oils,
      seasonings: row.seasonings,
      totals: row.totals,
    },
    known,
  );
}

export function savedToInsertRow(uid: string, s: SavedCombo) {
  return {
    id: s.id,
    user_id: uid,
    meal_type: s.mealType,
    signature: s.signature,
    request_fingerprint: s.requestFingerprint,
    items: s.items,
    oils: s.oils,
    seasonings: s.seasonings,
    totals: s.totals,
    created_at: toIso(s.savedAt),
  };
}

/** Rows -> combos, newest first, bad rows dropped. */
export function savedRowsToCombos(
  rows: readonly Partial<SavedComboRow>[] | null | undefined,
  known: KnownItemIds,
): SavedCombo[] {
  return (rows ?? [])
    .map((r) => savedRowToCombo(r, known))
    .filter((c): c is SavedCombo => c !== undefined)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function kitRowsToKits(
  rows: readonly Partial<KitRow>[] | null | undefined,
  known: KnownItemIds,
): IngredientKit[] {
  return (rows ?? [])
    .map((r) => kitRowToKit(r, known))
    .filter((k): k is IngredientKit => k !== undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
}
