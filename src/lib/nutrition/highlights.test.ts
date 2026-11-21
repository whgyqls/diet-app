import { describe, expect, it } from 'vitest';
import { foodHighlights, servingGrams } from './highlights';
import { food, makeFood } from './test-fixtures';

const chips = (id: string) =>
  foodHighlights(food(id)).chips.map((c) => c.label);
const line = (id: string) => foodHighlights(food(id)).keyLine.text;

describe('servingGrams', () => {
  it('uses the unit when there is one, else 100 g clamped to the portion range', () => {
    expect(servingGrams(food('egg'))).toBe(50);
    expect(servingGrams(food('chicken-breast'))).toBe(100);
    expect(servingGrams(food('perilla-leaf'))).toBe(60);
    expect(servingGrams(food('almond'))).toBe(30);
    expect(servingGrams(food('kabocha'))).toBe(100);
  });
});

describe('keyLine (per 100 g)', () => {
  it('protein: 단백질 · 지방 · kcal', () => {
    expect(line('chicken-breast')).toBe('단백질 23g · 지방 1g · 106kcal');
  });

  it('carb: 순탄수 · 식이섬유 · kcal', () => {
    expect(line('lentil')).toBe('순탄수 18.7g · 식이섬유 6.7g · 150kcal');
  });

  it('fiber: 식이섬유 · kcal + the top micronutrient when it reaches 15% of the daily value', () => {
    expect(line('spinach')).toBe('식이섬유 3.1g · 29kcal · 비타민A 많음');
    expect(line('cabbage')).toBe('식이섬유 2.5g · 29kcal · 비타민C 많음');
    expect(line('cucumber')).toBe('식이섬유 0.6g · 14kcal');
  });

  it('fat: 지방 · 식이섬유 · kcal', () => {
    expect(line('almond')).toBe('지방 51.3g · 식이섬유 11.3g · 594kcal');
  });
});

describe('chips (max 2)', () => {
  it('lean protein gets 저지방', () => {
    expect(chips('chicken-breast')).toEqual(['저지방']);
  });

  it('a caution comes first: 나트륨 많은 편 (>= 150 mg/100 g)', () => {
    expect(chips('squid')).toEqual(['나트륨 많은 편', '저지방']);
  });

  it('fatty protein gets 지방 많은 편 (>= 10 g/100 g); no micronutrient data is fine', () => {
    expect(chips('mackerel')[0]).toBe('지방 많은 편');
    expect(chips('greek-yogurt')).toEqual(['지방 많은 편']);
  });

  it('bonus badges come before micronutrients', () => {
    expect(chips('lentil')).toEqual(['단백질도 풍부', '식이섬유 풍부']);
    expect(chips('almond')).toEqual(['단백질도 풍부', '식이섬유 풍부']);
  });

  it('micronutrients are sorted by % daily value and skip the one already in the key line', () => {
    // spinach per 100 g serving: vitamin A 61% (key line), vitamin C 51%, iron 21%, potassium 20%
    expect(chips('spinach')).toEqual(['비타민C 많음', '철분 많음']);
  });

  it('shows at most one caution', () => {
    const both = makeFood({
      id: 'both',
      category: 'protein',
      per100g: {
        kcal: 200,
        protein: 20,
        carbs: 0,
        fiber: 0,
        fat: 12,
        satFat: 0,
        sodium: 300,
        cholesterol: 0,
      },
    });
    expect(foodHighlights(both).chips.map((c) => c.label)).toEqual([
      '나트륨 많은 편',
    ]);
  });

  it('only protein sources get 저지방', () => {
    expect(chips('cucumber')).not.toContain('저지방');
  });
});
