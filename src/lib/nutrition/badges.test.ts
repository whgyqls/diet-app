import { describe, expect, it } from 'vitest';
import { BONUS_BADGE_LABELS, badgeContributions, bonusBadges } from './badges';
import { food, makeFood } from './test-fixtures';

const labels = (id: string) =>
  bonusBadges(food(id)).map((b) => BONUS_BADGE_LABELS[b]);

describe('bonusBadges', () => {
  it('gives legumes both badges (carb source with protein >= 8 g and fiber >= 5 g)', () => {
    expect(labels('lentil')).toEqual(['단백질도 풍부', '식이섬유 풍부']);
    expect(labels('chickpea')).toEqual(['단백질도 풍부', '식이섬유 풍부']);
  });

  it('never gives a protein source the protein badge (black soybean gets fiber only)', () => {
    expect(labels('black-soybean')).toEqual(['식이섬유 풍부']);
    expect(labels('chicken-breast')).toEqual([]);
  });

  it('never gives a fiber source the fiber badge', () => {
    expect(labels('perilla-leaf')).toEqual([]);
    expect(labels('shiitake')).toEqual([]);
  });

  it('applies to fat sources too', () => {
    expect(labels('almond')).toEqual(['단백질도 풍부', '식이섬유 풍부']);
    expect(labels('avocado')).toEqual(['식이섬유 풍부']);
  });

  it('uses inclusive thresholds (8 g protein, 5 g fiber)', () => {
    const edge = makeFood({
      id: 'edge',
      category: 'carb',
      per100g: {
        kcal: 100,
        protein: 8,
        carbs: 20,
        fiber: 5,
        fat: 0,
        satFat: 0,
        sodium: 0,
        cholesterol: 0,
      },
    });
    expect(bonusBadges(edge)).toEqual(['PROTEIN_RICH', 'FIBER_RICH']);
    const below = makeFood({
      id: 'below',
      category: 'carb',
      per100g: {
        kcal: 100,
        protein: 7.9,
        carbs: 20,
        fiber: 4.9,
        fat: 0,
        satFat: 0,
        sodium: 0,
        cholesterol: 0,
      },
    });
    expect(bonusBadges(below)).toEqual([]);
  });
});

describe('badgeContributions', () => {
  it('shows how much the badge foods add to the meal protein and fiber', () => {
    const items = [
      { food: food('chicken-breast'), grams: 100 }, // 23 g protein
      { food: food('lentil'), grams: 100 }, // 9.8 g protein, 6.7 g fiber
      { food: food('cabbage'), grams: 100 }, // 1.4 g protein, 2.5 g fiber
    ];
    const res = badgeContributions(items);
    const protein = res.find((r) => r.nutrient === 'protein')!;
    expect(protein.total).toBeCloseTo(34.2, 6);
    expect(protein.items).toEqual([
      { food: food('lentil'), amount: expect.closeTo(9.8, 6) },
    ]);
    const fiber = res.find((r) => r.nutrient === 'fiber')!;
    expect(fiber.total).toBeCloseTo(9.2, 6);
    expect(fiber.items).toEqual([
      { food: food('lentil'), amount: expect.closeTo(6.7, 6) },
    ]);
  });

  it('is empty when no badge food is in the meal', () => {
    expect(
      badgeContributions([
        { food: food('chicken-breast'), grams: 150 },
        { food: food('broccoli'), grams: 100 },
      ]),
    ).toEqual([]);
  });
});
