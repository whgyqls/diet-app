// "재료 바꾸기": same-category replacements for one food of a combo, portions recalculated by the engine. Pure.
import type { Food, Seasoning } from '@/types/food';
import type {
  ComboFoods,
  MealCombo,
  MealTargets,
  Selection,
} from '@/types/nutrition';
import {
  buildMealCombo,
  comboContext,
  isOil,
  proteinGroupOf,
} from './generate';

export type SwapSlot = {
  category: 'protein' | 'carb' | 'fiber' | 'fat';
  foodId: string;
};

export type SwapContext = {
  foods: Food[];
  seasonings: Seasoning[];
  selection: Selection;
  targets: MealTargets;
  excludeFoods?: string[];
  /** Combos picked for the OTHER meals (only used to flag overlaps; nothing is hidden). */
  otherPicked: MealCombo[];
};

export type SwapCandidate = {
  food: Food;
  /** The combo with the replacement and re-portioned, or null when it cannot be portioned. */
  combo: MealCombo | null;
  overlapsOtherMeal: boolean;
};

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

/** The foods of a combo by slot (oils are not part of ComboFoods). */
function comboFoodsOf(combo: MealCombo): ComboFoods {
  const of = (cat: Food['category']) =>
    combo.items.filter((i) => i.food.category === cat).map((i) => i.food);
  return {
    protein: of('protein')[0],
    carb: of('carb')[0],
    fibers: of('fiber'),
    fat: of('fat')[0],
  };
}

export function swapCandidates(
  combo: MealCombo,
  slot: SwapSlot,
  ctx: SwapContext,
): SwapCandidate[] {
  const current = combo.items.find(
    (i) => i.food.id === slot.foodId && i.food.category === slot.category,
  );
  if (!current) return [];

  const { selection, targets } = ctx;
  const excludedIds = new Set(ctx.excludeFoods ?? []);
  const excludedGroups = new Set(targets.rules.excludedGroups);
  // Same filter as mealCandidates; oils stay in this list because the oil slot needs them.
  const selected = ctx.foods
    .filter(
      (f) =>
        selection.foods[f.id] &&
        !excludedIds.has(f.id) &&
        !excludedGroups.has(f.group),
    )
    .sort(byId);
  const inCombo = new Set(combo.items.map((i) => i.food.id));
  const replacements = selected.filter(
    (f) => f.category === slot.category && !isOil(f) && !inCombo.has(f.id),
  );

  const build = comboContext(selected, ctx.seasonings, selection);
  const base = comboFoodsOf(combo);
  const otherGroups = new Set(
    ctx.otherPicked.map((o) =>
      proteinGroupOf(o.items.find((i) => i.food.category === 'protein')!.food),
    ),
  );
  const otherFoodIds = new Set(
    ctx.otherPicked.flatMap((o) => o.items.map((i) => i.food.id)),
  );

  const out: SwapCandidate[] = replacements.map((food) => {
    const foods: ComboFoods = { ...base };
    if (slot.category === 'protein') foods.protein = food;
    else if (slot.category === 'carb') foods.carb = food;
    else if (slot.category === 'fat') foods.fat = food;
    else
      foods.fibers = base.fibers.map((f) => (f.id === slot.foodId ? food : f));
    const group =
      slot.category === 'protein' ? proteinGroupOf(food) : undefined;
    return {
      food,
      combo: buildMealCombo(foods, targets, build),
      overlapsOtherMeal:
        otherFoodIds.has(food.id) ||
        (group !== undefined && otherGroups.has(group)),
    };
  });
  // Buildable first (best score), then the ones that cannot be portioned.
  return out.sort((a, b) => {
    if (!a.combo !== !b.combo) return a.combo ? -1 : 1;
    if (a.combo && b.combo)
      return (
        a.combo.score.total - b.combo.score.total ||
        a.food.id.localeCompare(b.food.id)
      );
    return a.food.id.localeCompare(b.food.id);
  });
}
