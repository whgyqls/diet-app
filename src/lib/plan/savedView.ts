// Display helpers for the saved combos list (/saved). Pure: grouping, rounding and text only.
import type { MealType } from '@/types/nutrition';
import type { SavedCombo } from './savedCombos';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner'];

export type SavedGroup = { mealType: MealType; items: SavedCombo[] };

/** Breakfast, lunch, dinner groups (empty ones left out); inside a group the newest comes first. */
export function groupSavedByMeal(list: readonly SavedCombo[]): SavedGroup[] {
  return MEAL_ORDER.map((mealType) => ({
    mealType,
    // Array.prototype.sort is stable, so equal times keep their order.
    items: list
      .filter((s) => s.mealType === mealType)
      .sort((a, b) => b.savedAt - a.savedAt),
  })).filter((g) => g.items.length > 0);
}

export type SavedSummary = {
  items: { name: string; grams: number; basis: 'raw' | 'cooked' }[];
  oils: { name: string; grams: number }[];
  seasonings: { name: string; text: string }[];
  totals: {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    sodium: number;
  };
};

/** What a saved card shows: rounded totals, foods with their basis, oils, seasoning amounts. */
export function savedSummary(s: SavedCombo): SavedSummary {
  const t = s.totals;
  return {
    items: s.items.map(({ name, grams, basis }) => ({ name, grams, basis })),
    oils: s.oils.map(({ name, grams }) => ({ name, grams })),
    seasonings: s.seasonings.map((x) => ({
      name: x.name,
      text: `${Number(x.units.toFixed(1))}${x.unitLabel}`,
    })),
    totals: {
      kcal: Math.round(t.kcal),
      protein: Math.round(t.protein),
      carbs: Math.round(t.carbs),
      fat: Math.round(t.fat),
      fiber: Math.round(t.fiber),
      sodium: Math.round(t.sodium),
    },
  };
}

/** "11월 22일" in the given time zone (default: the browser's). */
export function savedDateText(savedAt: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(savedAt));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('month')}월 ${get('day')}일`;
}
