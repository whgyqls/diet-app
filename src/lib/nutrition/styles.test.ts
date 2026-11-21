import { describe, expect, it } from 'vitest';
import {
  KCAL_FILL_ORDER,
  KCAL_FILL_ORDER_LOW_CARB,
  PROTEIN_GROUPS,
} from './constants';
import { resolveStyles } from './styles';
import { calcDayTargets, calcMealTargets } from './targets';
import { EXAMPLE_PROFILES, REF_YEAR } from './test-fixtures';

const [loseF, maintainM, gainM] = EXAMPLE_PROFILES.map((e) => e.profile);
const MEAT = [...PROTEIN_GROUPS.meat];
const SEAFOOD = [...PROTEIN_GROUPS.seafood];

describe('resolveStyles', () => {
  it('no style = the default diet', () => {
    const s = resolveStyles([], 'maintain');
    expect(s.styles).toEqual([]);
    expect(s.excludedGroups).toEqual([]);
    expect(s.dropTotalCarbMin).toBe(false);
    expect(s.lowCarbFill).toBe(false);
    expect(s.requireTwoFiberSources).toBe(false);
    expect(s.preferNoCarb).toBe(false);
    expect(s.sodiumMax).toBeUndefined();
    expect(s.totalCarbRatioMax).toBeUndefined();
  });

  it('low carb: total carb cap 25/30/35% by goal, no 100 g floor, low-carb fill order, no-carb preference', () => {
    expect(resolveStyles(['lowCarb'], 'lose').totalCarbRatioMax).toBe(0.25);
    expect(resolveStyles(['lowCarb'], 'maintain').totalCarbRatioMax).toBe(0.3);
    expect(resolveStyles(['lowCarb'], 'gain').totalCarbRatioMax).toBe(0.35);
    const s = resolveStyles(['lowCarb'], 'lose');
    expect(s.dropTotalCarbMin).toBe(true);
    expect(s.lowCarbFill).toBe(true);
    expect(s.preferNoCarb).toBe(true);
    expect(s.fatMaxRatio).toBe(0.45);
  });

  it('low sodium: cap 1,500 mg and a smaller seasoning budget', () => {
    const s = resolveStyles(['lowSodium'], 'lose');
    expect(s.sodiumMax).toBe(1500);
    expect(s.seasoningBudgetRatio).toBeLessThan(0.6);
  });

  it('veggie forward: fiber 40 g, two fiber sources per meal, vegetables start at 150 g, net carbs x0.8', () => {
    const s = resolveStyles(['veggieForward'], 'maintain');
    expect(s.fiberDayMin).toBe(40);
    expect(s.requireTwoFiberSources).toBe(true);
    expect(s.veggieStartG).toBe(150);
    expect(s.netCarbMultiplier).toBe(0.8);
  });

  it('high protein: 1.8 g/kg base and 2.0 g/kg fill cap', () => {
    const s = resolveStyles(['highProtein'], 'maintain');
    expect(s.proteinPerKgBase).toBe(1.8);
    expect(s.proteinPerKgFillMax).toBe(2.0);
  });

  it('pescatarian excludes the meat groups; lacto-ovo also excludes seafood', () => {
    expect(resolveStyles(['pescatarian'], 'lose').excludedGroups).toEqual(MEAT);
    expect(
      [...resolveStyles(['lactoOvo'], 'lose').excludedGroups].sort(),
    ).toEqual([...MEAT, ...SEAFOOD].sort());
  });

  it('combining: exclusions are merged (union), numbers take the stricter side, order and duplicates do not matter', () => {
    const a = resolveStyles(['pescatarian', 'lactoOvo'], 'lose');
    expect([...a.excludedGroups].sort()).toEqual([...MEAT, ...SEAFOOD].sort());

    const b = resolveStyles(['lowCarb', 'veggieForward', 'lowSodium'], 'gain');
    const c = resolveStyles(
      ['lowSodium', 'veggieForward', 'lowCarb', 'lowCarb'],
      'gain',
    );
    expect(b).toEqual(c);
    expect(b.totalCarbRatioMax).toBe(0.35);
    expect(b.requireTwoFiberSources).toBe(true);
    expect(b.sodiumMax).toBe(1500);
    expect(b.fiberDayMin).toBe(40);
    expect(b.styles.sort()).toEqual(['lowCarb', 'lowSodium', 'veggieForward']);
  });
});

describe('calcDayTargets with styles (default -> style -> override)', () => {
  const withStyles = (
    p: typeof loseF,
    styles: Parameters<typeof resolveStyles>[0],
    overrides = {},
  ) => calcDayTargets(p, REF_YEAR, overrides, resolveStyles(styles, p.goal));

  it('without styles the default rules apply', () => {
    const { targets } = calcDayTargets(loseF, REF_YEAR);
    expect(targets.rules.fillOrder).toEqual(KCAL_FILL_ORDER);
    expect(targets.rules.veggieStartG).toBe(100);
    expect(targets.rules.requireTwoFiberSources).toBe(false);
    expect(targets.rules.excludedGroups).toEqual([]);
    expect(targets.rules.preferNoCarb).toBe(false);
    expect(targets.rules.seasoningBudgetRatio).toBe(0.6);
  });

  it('low carb (weight loss): 25% total carbs, floor 0, fat up to 45%, low-carb fill order', () => {
    const { targets } = withStyles(loseF, ['lowCarb']);
    expect(targets.totalCarbMax).toBeCloseTo((targets.kcal * 0.25) / 4, 6);
    expect(targets.totalCarbMin).toBe(0);
    expect(targets.fat.stage3).toBeCloseTo((targets.kcal * 0.45) / 9, 6);
    expect(targets.fat.stage2).toBeCloseTo((targets.kcal * 0.35) / 9, 6);
    expect(targets.rules.fillOrder).toEqual(KCAL_FILL_ORDER_LOW_CARB);
    expect(targets.rules.preferNoCarb).toBe(true);
    // base net carbs never above the style's total cap
    expect(targets.netCarbMax).toBeLessThanOrEqual(targets.totalCarbMax);
  });

  it('low carb by goal: maintenance 30%, muscle gain 35%', () => {
    const m = withStyles(maintainM, ['lowCarb']).targets;
    const g = withStyles(gainM, ['lowCarb']).targets;
    expect(m.totalCarbMax).toBeCloseTo((m.kcal * 0.3) / 4, 6);
    expect(g.totalCarbMax).toBeCloseTo((g.kcal * 0.35) / 4, 6);
  });

  it('low sodium: cap 1,500 mg without a LOW_SODIUM setting warning (1,500 is not below 1,500)', () => {
    const { targets, flags } = withStyles(loseF, ['lowSodium']);
    expect(targets.sodiumMax).toBe(1500);
    expect(flags).not.toContain('LOW_SODIUM');
    expect(targets.rules.seasoningBudgetRatio).toBeLessThan(0.6);
  });

  it('veggie forward: fiber 40 g/day, 150 g vegetables, base net carbs x0.8, two fiber sources', () => {
    const base = calcDayTargets(maintainM, REF_YEAR).targets;
    const { targets } = withStyles(maintainM, ['veggieForward']);
    expect(targets.fiberMin).toBe(40);
    expect(targets.rules.veggieStartG).toBe(150);
    expect(targets.rules.requireTwoFiberSources).toBe(true);
    expect(targets.netCarbMax).toBeCloseTo(base.netCarbMax * 0.8, 6);
  });

  it('veggie forward raises a lower KDRI fiber minimum (woman 20 g -> 40 g) but never lowers a higher one', () => {
    expect(withStyles(loseF, ['veggieForward']).targets.fiberMin).toBe(40);
  });

  it('high protein: 1.8 g/kg base and 2.0 g/kg cap, also for maintenance', () => {
    const { targets } = withStyles(maintainM, ['highProtein']);
    expect(targets.protein.base).toBeCloseTo(75 * 1.8, 6);
    expect(targets.protein.max).toBeCloseTo(75 * 2.0, 6);
  });

  it('excluded groups reach the targets', () => {
    expect(
      withStyles(maintainM, ['pescatarian']).targets.rules.excludedGroups,
    ).toEqual(MEAT);
  });

  it('user overrides win over styles', () => {
    expect(
      withStyles(loseF, ['lowSodium'], { sodiumMax: 1800 }).targets.sodiumMax,
    ).toBe(1800);
    const p = withStyles(maintainM, ['highProtein'], {
      protein: { perKg: 1.2 },
    }).targets.protein;
    expect(p.base).toBeCloseTo(75 * 1.2, 6);
    expect(p.max).toBeCloseTo(75 * 1.2, 6);
    const n = withStyles(maintainM, ['veggieForward'], {
      netCarbs: { g: 90 },
    }).targets;
    expect(n.netCarbMax).toBe(90);
  });

  it('a user sodium cap below 1,500 mg still raises LOW_SODIUM with the low-sodium style', () => {
    expect(
      withStyles(loseF, ['lowSodium'], { sodiumMax: 1400 }).flags,
    ).toContain('LOW_SODIUM');
  });
});

describe('calcMealTargets with per-meal kcal ratios', () => {
  const day = calcDayTargets(maintainM, REF_YEAR).targets;
  const ratios = (opts?: Parameters<typeof calcMealTargets>[2]) =>
    calcMealTargets(day, 3, opts).map((m) => m.ratio);

  it('default split without options', () => {
    expect(ratios()).toEqual([0.3, 0.35, 0.35]);
  });

  it('a set ratio is kept; the others share the rest in their usual proportions; the sum stays 1', () => {
    const r = ratios({ lunch: { kcalRatio: 0.5 } });
    expect(r[1]).toBe(0.5);
    expect(r[0] / r[2]).toBeCloseTo(0.3 / 0.35, 9);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('every ratio set -> normalized to sum 1', () => {
    const r = ratios({
      breakfast: { kcalRatio: 0.2 },
      lunch: { kcalRatio: 0.4 },
      dinner: { kcalRatio: 0.6 },
    });
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(r[2] / r[0]).toBeCloseTo(3, 9);
  });

  it('meal targets scale with the ratio (kcal and protein)', () => {
    const m = calcMealTargets(day, 3, { lunch: { kcalRatio: 0.5 } })[1];
    expect(m.kcal).toBeCloseTo(day.kcal * 0.5, 6);
    expect(m.protein.base).toBeCloseTo(day.protein.base * 0.5, 6);
  });

  it('ratios below 0 or above 1 are ignored', () => {
    expect(ratios({ lunch: { kcalRatio: 1.5 } })).toEqual([0.3, 0.35, 0.35]);
    expect(ratios({ lunch: { kcalRatio: 0 } })).toEqual([0.3, 0.35, 0.35]);
  });
});
