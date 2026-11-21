import { beforeAll, describe, expect, it } from 'vitest';
import type { Food } from '@/types/food';
import type {
  ComboFoods,
  MealCombo,
  MealTargets,
  Selection,
} from '@/types/nutrition';
import {
  buildMealCombo,
  comboContext,
  comboProteinGroup,
  proteinGroupOf,
} from './generate';
import { generateMealOptions } from './mealOptions';
import { resolveStyles } from './styles';
import { swapCandidates, type SwapContext } from './swap';
import { calcDayTargets, calcMealTargets } from './targets';
import {
  EXAMPLE_PROFILES,
  FOODS,
  REF_YEAR,
  SEASONINGS,
  makeFood,
  selectAll,
} from './test-fixtures';

const profile = EXAMPLE_PROFILES[1].profile;
let lunch: MealTargets;
let combo: MealCombo;

const ctxOf = (over: Partial<SwapContext> = {}): SwapContext => ({
  foods: FOODS,
  seasonings: SEASONINGS,
  selection: selectAll(),
  targets: lunch,
  otherPicked: [],
  ...over,
});

beforeAll(() => {
  const { targets } = calcDayTargets(
    profile,
    REF_YEAR,
    undefined,
    resolveStyles([], profile.goal),
  );
  lunch = calcMealTargets(targets, 3)[1];
  // a combo with a carb and two vegetables and a fat source, so every slot exists
  const all = generateMealOptions({
    foods: FOODS,
    seasonings: SEASONINGS,
    selection: selectAll(),
    targets: lunch,
    count: 40,
  }).combos;
  combo =
    all.find(
      (c) =>
        c.items.some((i) => i.food.category === 'carb') &&
        c.items.some((i) => i.food.category === 'fat') &&
        c.items.filter((i) => i.food.category === 'fiber').length === 2,
    ) ?? all[0];
});

const idsOf = (c: MealCombo, cat: Food['category']) =>
  c.items.filter((i) => i.food.category === cat).map((i) => i.food.id);
const first = (cat: Food['category']) => idsOf(combo, cat)[0];

describe('swapCandidates', () => {
  it('lists only foods of the same category, never oils, never what is already in the combo', () => {
    for (const cat of ['protein', 'carb', 'fiber', 'fat'] as const) {
      const slot = { category: cat, foodId: first(cat) };
      const list = swapCandidates(combo, slot, ctxOf());
      expect(list.length, cat).toBeGreaterThan(0);
      for (const c of list) {
        expect(c.food.category).toBe(cat);
        expect(c.food.group).not.toBe('기름');
        expect(combo.items.map((i) => i.food.id)).not.toContain(c.food.id);
      }
    }
  });

  it('recalculates the portions: same result as building the combo with the replacement directly', () => {
    const slot = { category: 'protein' as const, foodId: first('protein') };
    const cand = swapCandidates(combo, slot, ctxOf()).find((c) => c.combo)!;
    const foods: ComboFoods = {
      protein: cand.food,
      carb: combo.items.find((i) => i.food.category === 'carb')?.food,
      fibers: combo.items
        .filter((i) => i.food.category === 'fiber')
        .map((i) => i.food),
      fat: combo.items.find((i) => i.food.category === 'fat')?.food,
    };
    const direct = buildMealCombo(
      foods,
      lunch,
      comboContext(FOODS, SEASONINGS, selectAll()),
    )!;
    expect(cand.combo!.key).toBe(direct.key);
    expect(cand.combo!.totals).toEqual(direct.totals);
    expect(cand.combo!.items.map((i) => [i.food.id, i.grams])).toEqual(
      direct.items.map((i) => [i.food.id, i.grams]),
    );
  });

  it('keeps every other slot as it was', () => {
    const slot = { category: 'carb' as const, foodId: first('carb') };
    const cand = swapCandidates(combo, slot, ctxOf()).find((c) => c.combo)!;
    expect(idsOf(cand.combo!, 'protein')).toEqual(idsOf(combo, 'protein'));
    expect(idsOf(cand.combo!, 'fiber').sort()).toEqual(
      idsOf(combo, 'fiber').sort(),
    );
    expect(idsOf(cand.combo!, 'fat')).toEqual(idsOf(combo, 'fat'));
    expect(idsOf(cand.combo!, 'carb')).toEqual([cand.food.id]);
  });

  it('a vegetable swap never duplicates the other vegetable of the combo', () => {
    const [a, b] = idsOf(combo, 'fiber');
    const list = swapCandidates(
      combo,
      { category: 'fiber', foodId: a },
      ctxOf(),
    );
    expect(list.map((c) => c.food.id)).not.toContain(b);
    for (const c of list.filter((x) => x.combo)) {
      const ids = idsOf(c.combo!, 'fiber');
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain(b);
    }
  });

  it('only offers foods the user selected, and respects style exclusions and excluded foods', () => {
    const sel: Selection = {
      foods: Object.fromEntries(
        [
          ...combo.items.map((i) => i.food.id),
          'cod',
          'beef-eye-round',
          'tofu',
        ].map((id) => [id, 'ok' as const]),
      ),
      seasonings: {},
    };
    const slot = { category: 'protein' as const, foodId: first('protein') };
    const ids = swapCandidates(combo, slot, ctxOf({ selection: sel })).map(
      (c) => c.food.id,
    );
    expect(ids.sort()).toEqual(
      ['beef-eye-round', 'cod', 'tofu']
        .filter((i) => i !== first('protein'))
        .sort(),
    );

    const noMeat = swapCandidates(
      combo,
      slot,
      ctxOf({
        selection: sel,
        targets: {
          ...lunch,
          rules: { ...lunch.rules, excludedGroups: ['소고기'] },
        },
      }),
    ).map((c) => c.food.id);
    expect(noMeat).not.toContain('beef-eye-round');

    const excluded = swapCandidates(
      combo,
      slot,
      ctxOf({ selection: sel, excludeFoods: ['cod'] }),
    ).map((c) => c.food.id);
    expect(excluded).not.toContain('cod');
  });

  it('gives combo null (not a crash) when the replacement cannot be portioned', () => {
    const huge = makeFood({
      id: 'huge-fat',
      category: 'fat',
      per100g: {
        kcal: 900,
        protein: 0,
        carbs: 0,
        fiber: 0,
        fat: 100,
        satFat: 0,
        sodium: 0,
        cholesterol: 0,
      },
      portion: { min: 500, max: 600, step: 10 },
    });
    const sel = {
      ...selectAll(),
      foods: { ...selectAll().foods, 'huge-fat': 'ok' as const },
    };
    const list = swapCandidates(
      combo,
      { category: 'fat', foodId: first('fat') },
      ctxOf({ foods: [...FOODS, huge], selection: sel }),
    );
    const h = list.find((c) => c.food.id === 'huge-fat')!;
    expect(h.combo).toBeNull();
  });

  it('puts buildable candidates first (best score first) and unbuildable ones last', () => {
    const list = swapCandidates(
      combo,
      { category: 'protein', foodId: first('protein') },
      ctxOf(),
    );
    const firstNull = list.findIndex((c) => c.combo === null);
    if (firstNull >= 0)
      expect(list.slice(firstNull).every((c) => c.combo === null)).toBe(true);
    const scores = list.filter((c) => c.combo).map((c) => c.combo!.score.total);
    expect(scores).toEqual([...scores].sort((x, y) => x - y));
  });

  it('flags a candidate that overlaps the other meals (same protein group or a food they use)', () => {
    const other = generateMealOptions({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: selectAll(),
      targets: lunch,
      count: 5,
    }).combos.find(
      (c) => c.key !== combo.key && comboProteinGroup(c) !== undefined,
    )!;
    const group = comboProteinGroup(other);
    const list = swapCandidates(
      combo,
      { category: 'protein', foodId: first('protein') },
      ctxOf({ otherPicked: [other] }),
    );
    for (const c of list) {
      const sameGroup = proteinGroupOf(c.food) === group;
      const sameFood = other.items.some((i) => i.food.id === c.food.id);
      expect(c.overlapsOtherMeal, c.food.id).toBe(sameGroup || sameFood);
    }
    expect(list.some((c) => c.overlapsOtherMeal)).toBe(true);
  });

  it('returns nothing when the slot food is not in the combo or the category does not match', () => {
    expect(
      swapCandidates(
        combo,
        { category: 'protein', foodId: 'not-here' },
        ctxOf(),
      ),
    ).toEqual([]);
    expect(
      swapCandidates(
        combo,
        { category: 'carb', foodId: first('protein') },
        ctxOf(),
      ),
    ).toEqual([]);
  });
});
