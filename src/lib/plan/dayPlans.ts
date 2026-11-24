// Saved day plans (6a): what was eaten at each meal of one date, as a snapshot (names, grams, totals), not a
// reference to cards that change. Pure: dates, building the snapshot from the picked combos, checking rows read
// from the server, and display text. The table is day_plans (supabase/migrations/0004_day_plans.sql).
import { z } from 'zod';
import { isUuid } from '@/lib/id/newUuid';
import type { MealCombo, MealType, NutrientTotals } from '@/types/nutrition';
import { snapshotOf, type SavedItem, type SavedSeasoning } from './savedCombos';

/** The dates the table accepts (its check constraint). Future dates are allowed. */
export const DAY_PLAN_MIN_DATE = '2020-01-01';
export const DAY_PLAN_MAX_DATE = '2099-12-31';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Today as YYYY-MM-DD in the browser's own time zone (a person in Korea saving at 00:30 means that day, not the
 * UTC date). The AI explanation counts its daily limit on the UTC date instead: that is a different thing.
 */
export function localDateText(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A real calendar date written YYYY-MM-DD, inside the allowed range. */
export function isValidDateText(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  if (s < DAY_PLAN_MIN_DATE || s > DAY_PLAN_MAX_DATE) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === m - 1 &&
    t.getUTCDate() === d
  );
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** "2026-11-24 (화)". The weekday of the calendar date, whatever the time zone. */
export function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${date} (${WEEKDAYS[day]})`;
}

export type DayPlanMeal = {
  mealType: MealType;
  items: SavedItem[];
  oils: SavedItem[];
  seasonings: SavedSeasoning[];
  totals: NutrientTotals;
};
export type DayPlanData = {
  v: 1;
  /** Only the meals that have a picked combo. */
  meals: DayPlanMeal[];
  totals: NutrientTotals;
};
export type SavedDayPlan = { id: string; date: string; plan: DayPlanData };

/**
 * The snapshot of the combos picked now, or null when no meal has one. Nothing about the person is in it:
 * no profile, no targets, only foods, grams and totals.
 */
export function dayPlanOf(
  meals: readonly { mealType: MealType; picked?: { combo: MealCombo } }[],
  dayTotals: NutrientTotals,
): DayPlanData | null {
  const out: DayPlanMeal[] = [];
  for (const m of meals) {
    if (!m.picked) continue;
    const s = snapshotOf(m.picked.combo, {
      id: '',
      mealType: m.mealType,
      requestFingerprint: '',
      savedAt: 0,
    });
    out.push({
      mealType: m.mealType,
      items: s.items,
      oils: s.oils,
      seasonings: s.seasonings,
      totals: s.totals,
    });
  }
  return out.length === 0
    ? null
    : { v: 1, meals: out, totals: { ...dayTotals } };
}

const num = z.number().finite();
const itemSchema = z.object({
  foodId: z.string().max(64),
  name: z.string().max(100),
  grams: num.min(0).max(5000),
  basis: z.enum(['raw', 'cooked']),
});
const totalsSchema = z.object({
  kcal: num,
  protein: num,
  carbs: num,
  netCarbs: num,
  fiber: num,
  fat: num,
  satFat: num,
  sodium: num,
  cholesterol: num,
});
export const dayPlanDataSchema = z.object({
  v: z.literal(1),
  meals: z
    .array(
      z.object({
        mealType: z.enum(['breakfast', 'lunch', 'dinner']),
        items: z.array(itemSchema).max(8),
        oils: z.array(itemSchema).max(3),
        seasonings: z
          .array(
            z.object({
              id: z.string().max(64),
              name: z.string().max(100),
              units: num.min(0).max(100),
              unitLabel: z.string().max(20),
            }),
          )
          .max(10),
        totals: totalsSchema,
      }),
    )
    .min(1)
    .max(3),
  totals: totalsSchema,
});

/** Rows read from the server are not trusted: a bad row is dropped, the rest is shown. Newest date first. */
export function savedDayPlansFromRows(rows: unknown): SavedDayPlan[] {
  if (!Array.isArray(rows)) return [];
  const out: SavedDayPlan[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const plan = dayPlanDataSchema.safeParse(r?.plan);
    if (
      !plan.success ||
      !isUuid(r.id) ||
      typeof r.date !== 'string' ||
      !isValidDateText(r.date)
    )
      continue;
    out.push({ id: r.id, date: r.date, plan: plan.data });
  }
  return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}
