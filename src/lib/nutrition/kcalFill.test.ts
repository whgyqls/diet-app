// The plan reaches a reasonable share of the kcal target, or says why it cannot (PLAN.md 4.2).
// Grid: meals per day x style combinations x which food groups are selected (carb / oil / nut-seed-avocado).
import { describe, expect, it } from 'vitest';
import type { DietStyle, DayPlan, Profile } from '@/types/nutrition';
import { KCAL_FILL_MIN_RATIO, KCAL_FLOOR } from './constants';
import { generateDayPlan } from './generate';
import { kcalFillOf, kcalGapReasons } from './kcalGap';
import { FOODS, REF_YEAR, SEASONINGS } from './test-fixtures';

const MAN: Omit<Profile, 'mealsPerDay'> = {
  sex: 'male',
  birthYear: 2004,
  heightCm: 172,
  weightKg: 70,
  activityLevel: 2,
  goal: 'lose',
};
const WOMAN: Omit<Profile, 'mealsPerDay'> = {
  sex: 'female',
  birthYear: 1993,
  heightCm: 160,
  weightKg: 55,
  activityLevel: 2,
  goal: 'lose',
};

const selectionOf = (ids: string[], withSeasonings = true) => ({
  foods: Object.fromEntries(ids.map((id) => [id, 'ok' as const])),
  seasonings: withSeasonings
    ? Object.fromEntries(SEASONINGS.map((s) => [s.id, 'ok' as const]))
    : {},
});

const plan = (
  profile: Omit<Profile, 'mealsPerDay'>,
  meals: 2 | 3,
  ids: string[],
  styles: DietStyle[],
  withSeasonings = true,
): DayPlan =>
  generateDayPlan({
    foods: FOODS,
    seasonings: SEASONINGS,
    selection: selectionOf(ids, withSeasonings),
    profile: { ...profile, mealsPerDay: meals },
    refYear: REF_YEAR,
    conditions: { styles },
  });

describe('the reported case (829 kcal of 1,952)', () => {
  // Man, born 2004, 172 cm, 70 kg, activity 2, losing weight, 2 meals, styles low-carb + low-sodium +
  // high-protein. Selected: chicken breast, tofu, cabbage, lettuce, broccoli, carrot, perilla oil (no grains,
  // nuts or avocado), no seasonings. Before the fix: meals of 437 and 392 kcal, 829 in all.
  const ids = [
    'chicken-breast',
    'tofu',
    'cabbage',
    'lettuce',
    'broccoli',
    'carrot',
    'perilla-oil',
  ];
  const p = plan(MAN, 2, ids, ['lowCarb', 'lowSodium', 'highProtein'], false);

  it('keeps the numbers of the report: 1,952 kcal target, 94 g protein, 22 g fiber', () => {
    expect(Math.round(p.targets.kcal)).toBe(1952);
    expect(Math.round(p.totals.kcal)).toBe(829);
    expect(Math.round(p.totals.protein)).toBe(94);
    expect(Math.round(p.totals.fiber)).toBe(22);
    expect(
      p.meals.map((m) => Math.round(m.combos[0].totals.kcal)).sort(),
    ).toEqual([392, 437]);
  });

  it('is below 90%, and the app says so with the reasons that apply to this selection', () => {
    expect(p.flags).toContain('LOW_KCAL');
    expect(p.kcalFill?.cause).toBe('SELECTION');
    expect(p.kcalFill!.ceilingRatio).toBeLessThan(KCAL_FILL_MIN_RATIO);
    expect(p.kcalFill!.reasons).toEqual([
      'NO_CARB_FOOD',
      'LOW_CARB_STYLE',
      'NO_FAT_SOURCE',
      'PORTION_LIMITS',
    ]); // a perilla oil was selected, so NO_OIL is not listed
  });

  it('the kcal total is also listed under "못 채운 목표"', () => {
    expect(p.unmetTargets.map((u) => u.nutrient)).toContain('kcal');
  });
});

describe('kcalGapReasons / kcalFillOf', () => {
  const food = (category: 'carb' | 'fat' | 'protein', group = 'x') => ({
    category,
    group,
  });
  const targets = (preferNoCarb: boolean, carbTopUp = true) =>
    ({ carbTopUp, rules: { preferNoCarb } }) as never;

  it('lists what is missing, PORTION_LIMITS always last', () => {
    expect(kcalGapReasons([food('protein')], targets(false), false)).toEqual([
      'NO_CARB_FOOD',
      'NO_FAT_SOURCE',
      'NO_OIL',
      'PORTION_LIMITS',
    ]);
    expect(
      kcalGapReasons(
        [food('carb'), food('fat', '견과'), food('fat', '기름')],
        targets(false),
        false,
      ),
    ).toEqual(['PORTION_LIMITS']);
  });

  it('does not ask for a carb food when every meal is set to "no carb"', () => {
    expect(kcalGapReasons([], targets(false), true)).not.toContain(
      'NO_CARB_FOOD',
    );
  });

  it('names a user-set net carb amount', () => {
    expect(
      kcalGapReasons([food('carb')], targets(false, false), false),
    ).toContain('USER_CARB_LIMIT');
  });

  it('says nothing at 90% or more; SELECTION below the ceiling, CHOICE when the ceiling is reachable', () => {
    const ctx = { ceilingKcal: 1800, reasons: ['PORTION_LIMITS' as const] };
    expect(kcalFillOf(1800, 2000, ctx)).toBeUndefined(); // exactly 90%
    expect(kcalFillOf(1700, 2000, ctx)).toMatchObject({
      cause: 'CHOICE',
      reasons: [],
    });
    expect(
      kcalFillOf(1000, 2000, { ceilingKcal: 1500, reasons: ctx.reasons }),
    ).toMatchObject({ cause: 'SELECTION', reasons: ctx.reasons });
  });
});

// ---- the grid ------------------------------------------------------------------------------------

const STYLE_SETS: DietStyle[][] = [
  [],
  ['lowCarb'],
  ['lowSodium'],
  ['veggieForward'],
  ['highProtein'],
  ['pescatarian'],
  ['lactoOvo'],
  ['lowCarb', 'lowSodium', 'highProtein'],
  ['lowCarb', 'highProtein'],
  ['veggieForward', 'lowCarb'],
];
const GROUP_SETS = [true, false].flatMap((carb) =>
  [true, false].flatMap((oil) =>
    [true, false].map((nut) => ({
      name: `carb ${carb ? 'O' : 'X'} / oil ${oil ? 'O' : 'X'} / nut ${nut ? 'O' : 'X'}`,
      ids: FOODS.filter(
        (f) =>
          f.category === 'protein' ||
          f.category === 'fiber' ||
          (f.category === 'carb' && carb) ||
          (f.category === 'fat' && (f.group === '기름' ? oil : nut)),
      ).map((f) => f.id),
    })),
  ),
);

describe.each(STYLE_SETS.map((s) => [s.join('+') || 'no style', s] as const))(
  'grid: %s',
  (_name, styles) => {
    it('reaches 90% of the target, or says why it cannot (2 and 3 meals x 8 selections)', () => {
      const failures: string[] = [];
      for (const meals of [2, 3] as const)
        for (const g of GROUP_SETS) {
          const p = plan(MAN, meals, g.ids, styles);
          const ratio = p.totals.kcal / p.targets.kcal;
          const where = `${meals} meals, ${g.name}: ${(ratio * 100).toFixed(0)}%`;
          if (ratio >= KCAL_FILL_MIN_RATIO) {
            if (p.kcalFill || p.flags.includes('LOW_KCAL'))
              failures.push(`${where} says it is short`);
            continue;
          }
          // below 90%: it must be said, with the reasons, and the reason must be the selection
          if (!p.flags.includes('LOW_KCAL'))
            failures.push(`${where} no LOW_KCAL`);
          if (!p.unmetTargets.some((u) => u.nutrient === 'kcal'))
            failures.push(`${where} not in unmetTargets`);
          if (!p.kcalFill) {
            failures.push(`${where} no kcalFill`);
            continue;
          }
          if (p.kcalFill.cause !== 'SELECTION')
            failures.push(
              `${where} could reach ${(p.kcalFill.ceilingRatio * 100).toFixed(0)}% but did not`,
            );
          if (!p.kcalFill.reasons.includes('PORTION_LIMITS'))
            failures.push(`${where} no reasons`);
          if (
            p.totals.kcal < KCAL_FLOOR.male &&
            !p.flags.includes('KCAL_BELOW_FLOOR')
          )
            failures.push(`${where} below the floor without a warning`);
        }
      expect(failures).toEqual([]);
    });
  },
);

describe('a second profile (woman, 160 cm, 55 kg)', () => {
  it('2 and 3 meals, all foods and the low-carb styles: 90% or an explanation', () => {
    const all = FOODS.map((f) => f.id);
    for (const meals of [2, 3] as const)
      for (const styles of [[], ['lowCarb', 'highProtein']] as DietStyle[][]) {
        const p = plan(WOMAN, meals, all, styles);
        const ratio = p.totals.kcal / p.targets.kcal;
        if (ratio < KCAL_FILL_MIN_RATIO) {
          expect(p.kcalFill?.cause, `${meals} meals ${styles}`).toBe(
            'SELECTION',
          );
          expect(p.flags).toContain('LOW_KCAL');
        } else expect(p.kcalFill).toBeUndefined();
      }
  });
});
