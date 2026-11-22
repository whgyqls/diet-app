// Validators for data we do not trust: server rows (jsonb included) and the old localStorage record.
// Pure. A bad value is dropped (or the whole item is), never thrown, so one broken row cannot break a screen.
// Shared by src/lib/supabase/mappers.ts (reads) and the "이전 기록 불러오기" sanitizer (Phase 5e).
import { ADVANCED_LIMITS } from '@/lib/nutrition/constants';
import { KIT_NAME_MAX, type IngredientKit } from '@/lib/kits/kits';
import type {
  SavedCombo,
  SavedItem,
  SavedSeasoning,
} from '@/lib/plan/savedCombos';
import type {
  DietStyle,
  MealType,
  NutrientTotals,
  PrefStatus,
  Selection,
  TargetOverrides,
} from '@/types/nutrition';

export type KnownItemIds = {
  foods: ReadonlySet<string>;
  seasonings: ReadonlySet<string>;
};

/** Record<DietStyle, true>: adding a style to the type fails to compile until it is listed here. */
const STYLE_SET: Record<DietStyle, true> = {
  lowCarb: true,
  lowSodium: true,
  veggieForward: true,
  highProtein: true,
  pescatarian: true,
  lactoOvo: true,
};
const MEAL_SET: Record<MealType, true> = {
  breakfast: true,
  lunch: true,
  dinner: true,
};

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const has = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

/** A finite number that is 0 or more. */
export const isNonNegative = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

export function isDietStyle(v: unknown): v is DietStyle {
  return typeof v === 'string' && has(STYLE_SET, v);
}

export function isMealType(v: unknown): v is MealType {
  return typeof v === 'string' && has(MEAL_SET, v);
}

export function isPrefStatus(v: unknown): v is PrefStatus {
  return v === 'ok' || v === 'favorite';
}

/** Known styles only, no duplicates, original order. Not an array -> []. */
export function sanitizeStyles(raw: unknown): DietStyle[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isDietStyle))];
}

function sanitizePrefs(
  raw: unknown,
  known: ReadonlySet<string>,
): Record<string, PrefStatus> {
  const out: Record<string, PrefStatus> = {};
  if (!isRecord(raw)) return out;
  for (const [id, status] of Object.entries(raw))
    if (known.has(id) && isPrefStatus(status)) out[id] = status;
  return out;
}

/** Foods and seasonings that exist in the data, with a valid status. Anything else is dropped. */
export function sanitizeSelection(
  raw: unknown,
  known: KnownItemIds,
): Selection {
  const src = isRecord(raw) ? raw : {};
  return {
    foods: sanitizePrefs(src.foods, known.foods),
    seasonings: sanitizePrefs(src.seasonings, known.seasonings),
  };
}

const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/**
 * Only the forms the settings screen can produce (see overridesFromDraft): sodium cap, protein per kg,
 * net carbs in g, fat in g, each inside ADVANCED_LIMITS. Other keys and out-of-range values are dropped.
 */
export function sanitizeOverrides(raw: unknown): TargetOverrides {
  const out: TargetOverrides = {};
  if (!isRecord(raw)) return out;
  const A = ADVANCED_LIMITS;
  if (inRange(raw.sodiumMax, A.sodiumMg.min, A.sodiumMg.max))
    out.sodiumMax = raw.sodiumMax;
  if (
    isRecord(raw.protein) &&
    inRange(raw.protein.perKg, A.proteinPerKg.min, A.proteinPerKg.max)
  )
    out.protein = { perKg: raw.protein.perKg };
  if (
    isRecord(raw.netCarbs) &&
    inRange(raw.netCarbs.g, A.grams.min, A.grams.max)
  )
    out.netCarbs = { g: raw.netCarbs.g };
  if (isRecord(raw.fat) && inRange(raw.fat.g, A.grams.min, A.grams.max))
    out.fat = { g: raw.fat.g };
  return out;
}

/** The kit, cleaned, or undefined when it cannot be used (no id, bad name, bad times). */
export function sanitizeKit(
  raw: unknown,
  known: KnownItemIds,
): IngredientKit | undefined {
  if (!isRecord(raw) || !isNonEmptyString(raw.id)) return undefined;
  if (typeof raw.name !== 'string') return undefined;
  const name = raw.name.trim();
  if (name.length === 0 || [...name].length > KIT_NAME_MAX) return undefined;
  if (!isNonNegative(raw.createdAt) || !isNonNegative(raw.updatedAt))
    return undefined;
  return {
    id: raw.id,
    name,
    selection: sanitizeSelection(raw.selection, known),
    ...(Array.isArray(raw.styles)
      ? { styles: sanitizeStyles(raw.styles) }
      : {}),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

const TOTAL_KEYS: (keyof NutrientTotals)[] = [
  'kcal',
  'protein',
  'carbs',
  'netCarbs',
  'fiber',
  'fat',
  'satFat',
  'sodium',
  'cholesterol',
];

function sanitizeTotals(raw: unknown): NutrientTotals | undefined {
  if (!isRecord(raw)) return undefined;
  const out = {} as NutrientTotals;
  for (const k of TOTAL_KEYS) {
    const v = raw[k];
    if (!isNonNegative(v)) return undefined;
    out[k] = v;
  }
  return out;
}

function sanitizeSavedItems(
  raw: unknown,
  known: ReadonlySet<string>,
): SavedItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SavedItem[] = [];
  for (const i of raw) {
    if (!isRecord(i)) return undefined;
    if (typeof i.foodId !== 'string' || !known.has(i.foodId)) return undefined;
    if (!isNonEmptyString(i.name) || !isNonNegative(i.grams)) return undefined;
    if (i.basis !== 'raw' && i.basis !== 'cooked') return undefined;
    out.push({
      foodId: i.foodId,
      name: i.name,
      grams: i.grams,
      basis: i.basis,
    });
  }
  return out;
}

function sanitizeSavedSeasonings(
  raw: unknown,
  known: ReadonlySet<string>,
): SavedSeasoning[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SavedSeasoning[] = [];
  for (const s of raw) {
    if (!isRecord(s)) return undefined;
    if (typeof s.id !== 'string' || !known.has(s.id)) return undefined;
    if (!isNonEmptyString(s.name) || !isNonEmptyString(s.unitLabel))
      return undefined;
    if (!isNonNegative(s.units)) return undefined;
    out.push({
      id: s.id,
      name: s.name,
      units: s.units,
      unitLabel: s.unitLabel,
    });
  }
  return out;
}

/**
 * A saved (★) combo, or undefined when any part is unusable: unknown food or seasoning id, bad meal type,
 * no foods, negative or non-finite numbers. A combo is a snapshot, so it is kept whole or dropped whole.
 */
export function sanitizeSavedCombo(
  raw: unknown,
  known: KnownItemIds,
): SavedCombo | undefined {
  if (!isRecord(raw)) return undefined;
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.signature))
    return undefined;
  if (!isNonNegative(raw.savedAt) || !isMealType(raw.mealType))
    return undefined;
  if (typeof raw.requestFingerprint !== 'string') return undefined;
  const items = sanitizeSavedItems(raw.items, known.foods);
  const oils = sanitizeSavedItems(raw.oils, known.foods);
  const seasonings = sanitizeSavedSeasonings(raw.seasonings, known.seasonings);
  const totals = sanitizeTotals(raw.totals);
  if (!items || items.length === 0 || !oils || !seasonings || !totals)
    return undefined;
  return {
    id: raw.id,
    savedAt: raw.savedAt,
    mealType: raw.mealType,
    requestFingerprint: raw.requestFingerprint,
    signature: raw.signature,
    items,
    oils,
    seasonings,
    totals,
  };
}
