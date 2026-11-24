import { describe, expect, it } from 'vitest';
import type { MicroKey, NutrientTotals } from '@/types/nutrition';
import { FAVORITE_BONUS, KCAL_SCORE_INSIDE_WEIGHT } from './constants';
import { scoreCombo } from './scoring';
import { LUNCH } from './test-fixtures';

const ideal: NutrientTotals = {
  kcal: LUNCH.kcal,
  protein: LUNCH.protein.base,
  carbs: 45,
  netCarbs: LUNCH.netCarbMax,
  fiber: LUNCH.fiberMin,
  fat: LUNCH.fat.stage1,
  satFat: LUNCH.satFatTarget,
  sodium: LUNCH.sodiumMax,
  cholesterol: LUNCH.cholesterolMax,
};
const score = (over: Partial<NutrientTotals>, favorites = 0) =>
  scoreCombo({ ...ideal, ...over }, LUNCH, favorites);
/** g of fat (or saturated fat) that is `share` of the meal's target kcal */
const fatAt = (share: number) => (LUNCH.kcal * share) / 9;
const kcalAt = (ratio: number) => score({ kcal: LUNCH.kcal * ratio }).kcal;
/** Total without the small always-on saturated-fat term (satFatLow, PLAN.md 4.1-2). */
const core = (r: { total: number; satFatLow: number }) => r.total - r.satFatLow;

describe('scoreCombo', () => {
  it('prefers less saturated fat even below the 7% target (small always-on term)', () => {
    const low = score({ satFat: LUNCH.satFatTarget * 0.2 });
    const atTarget = score({ satFat: LUNCH.satFatTarget });
    expect(low.satFatAboveTarget).toBe(0);
    expect(low.satFatLow).toBeGreaterThan(0);
    expect(low.total).toBeLessThan(atTarget.total);
  });

  it('is 0 when every target is met exactly', () => {
    expect(core(score({}))).toBeCloseTo(0, 12);
  });

  it('does not penalize protein anywhere between base and max', () => {
    expect(core(score({ protein: LUNCH.protein.max }))).toBeCloseTo(0, 12);
    expect(score({ protein: LUNCH.protein.base - 5 }).protein).toBeGreaterThan(
      0,
    );
    expect(score({ protein: LUNCH.protein.max + 5 }).protein).toBeGreaterThan(
      0,
    );
  });

  it('penalizes kcal only a little within ±10%, still preferring closer to 100%', () => {
    expect(kcalAt(0.97)).toBeGreaterThan(0);
    expect(kcalAt(0.9)).toBeGreaterThan(kcalAt(0.97));
    expect(kcalAt(0.9)).toBeCloseTo(KCAL_SCORE_INSIDE_WEIGHT * 0.1, 9);
    expect(kcalAt(1.1)).toBeCloseTo(kcalAt(0.9), 9);
  });

  it('penalizes kcal beyond ±10% both ways, more for a bigger gap', () => {
    expect(kcalAt(0.85)).toBeGreaterThan(kcalAt(0.9));
    expect(kcalAt(1.15)).toBeGreaterThan(kcalAt(1.1));
    expect(kcalAt(0.7)).toBeGreaterThan(kcalAt(0.85));
  });

  it('allows total carbs up to 2 g over the 45% cap and penalizes below the 100 g/day share', () => {
    expect(score({ carbs: LUNCH.totalCarbMax + 2 }).carbOver).toBe(0);
    expect(score({ carbs: LUNCH.totalCarbMax + 2.5 }).carbOver).toBeGreaterThan(
      0,
    );
    expect(score({ carbs: LUNCH.totalCarbMin }).carbUnder).toBe(0);
    expect(score({ carbs: LUNCH.totalCarbMin - 5 }).carbUnder).toBeGreaterThan(
      0,
    );
  });

  it('judges total carbs on the kcal actually eaten: the same grams are over the cap in a smaller meal', () => {
    const grams = LUNCH.totalCarbMax; // exactly 45% when the target kcal is eaten
    expect(score({ carbs: grams }).carbOver).toBe(0);
    expect(
      score({ carbs: grams, kcal: LUNCH.kcal * 0.8 }).carbOver,
    ).toBeGreaterThan(0);
  });

  it('penalizes fiber below the minimum, and weakly above the soft max', () => {
    expect(score({ fiber: LUNCH.fiberMin - 2 }).fiberUnder).toBeGreaterThan(0);
    expect(score({ fiber: LUNCH.fiberSoftMax }).fiberOver).toBe(0);
    const overSoft = score({ fiber: LUNCH.fiberSoftMax * 1.5 }).fiberOver;
    expect(overSoft).toBeGreaterThan(0);
    expect(overSoft).toBeLessThan(
      score({ fiber: LUNCH.fiberMin * 0.5 }).fiberUnder,
    );
  });

  it('default diet: penalizes fat above 35% of the kcal eaten, not below', () => {
    expect(score({ fat: fatAt(0.34) }).fatOver).toBe(0); // the fixture's 35% cap is rounded to 20.8 g
    expect(score({ fat: fatAt(0.38) }).fatOver).toBeGreaterThan(0);
  });

  it('judges fat on the kcal actually eaten: 35% of the target is too much in a smaller meal', () => {
    expect(
      score({ fat: fatAt(0.35), kcal: LUNCH.kcal * 0.9 }).fatOver,
    ).toBeGreaterThan(0);
  });

  it('saturated fat: none below 7%, weak 7-10%, strong from 10%', () => {
    expect(score({ satFat: fatAt(0.06) }).satFatAboveTarget).toBe(0);
    const weak = score({ satFat: fatAt(0.09) });
    expect(weak.satFatAboveTarget).toBeGreaterThan(0);
    expect(weak.satFatOver).toBe(0);
    const strong = score({ satFat: fatAt(0.12) });
    expect(strong.satFatOver).toBeGreaterThan(0);
    expect(strong.satFatOver).toBeGreaterThan(weak.satFatAboveTarget);
  });

  it('penalizes cholesterol above the 300 mg/day share', () => {
    expect(score({ cholesterol: LUNCH.cholesterolMax }).cholesterolOver).toBe(
      0,
    );
    expect(
      score({ cholesterol: LUNCH.cholesterolMax * 1.5 }).cholesterolOver,
    ).toBeGreaterThan(0);
  });

  it('penalizes sodium over the cap, more for more', () => {
    expect(score({ sodium: LUNCH.sodiumMax + 100 }).sodiumOver).toBeGreaterThan(
      0,
    );
    expect(score({ sodium: LUNCH.sodiumMax + 200 }).total).toBeGreaterThan(
      score({ sodium: LUNCH.sodiumMax + 100 }).total,
    );
  });

  it('weakly penalizes micronutrients below their KDRI share, only when given', () => {
    const half = Object.fromEntries(
      Object.entries(LUNCH.micros).map(([k, v]) => [k, v / 2]),
    ) as Record<MicroKey, number>;
    expect(scoreCombo(ideal, LUNCH, 0, { ...LUNCH.micros }).microUnder).toBe(0);
    const short = scoreCombo(ideal, LUNCH, 0, half).microUnder;
    expect(short).toBeGreaterThan(0);
    expect(short).toBeLessThan(
      score({ fiber: LUNCH.fiberMin * 0.5 }).fiberUnder,
    );
    expect(score({}).microUnder).toBe(0);
  });

  it('penalizes a micronutrient only below 90% of its KDRI share', () => {
    const at = (r: number) =>
      scoreCombo(ideal, LUNCH, 0, {
        ...LUNCH.micros,
        calcium: LUNCH.micros.calcium * r,
      }).microUnder;
    expect(at(0.95)).toBe(0);
    expect(at(0.9)).toBe(0);
    expect(at(0.89)).toBeGreaterThan(0);
    expect(at(0.5)).toBeGreaterThan(at(0.89));
  });

  it('does not penalize a vitamin D shortfall (hard to cover from food), but still penalizes the others', () => {
    const noD = { ...LUNCH.micros, vitaminD: 0 };
    expect(scoreCombo(ideal, LUNCH, 0, noD).microUnder).toBe(0);
    const noCalcium = { ...LUNCH.micros, calcium: 0 };
    expect(scoreCombo(ideal, LUNCH, 0, noCalcium).microUnder).toBeGreaterThan(
      0,
    );
  });

  it('gives a bonus per favorite, so a favorite can outrank a slightly closer combo', () => {
    expect(core(score({}, 2))).toBeCloseTo(-2 * FAVORITE_BONUS, 9);
    // saturated fat scales with the kcal eaten, so only the kcal gap and the favorite differ
    const at = (r: number) => ({
      kcal: LUNCH.kcal * r,
      satFat: LUNCH.satFatTarget * r,
    });
    const closeNoFav = score(at(0.88));
    const fartherFav = score(at(0.86), 1);
    expect(fartherFav.total).toBeLessThan(closeNoFav.total);
  });
});
