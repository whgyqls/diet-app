// Full nutrition table rows for the bottom sheet: per 100 g and per serving.
import type { Food } from '@/types/food';
import { servingGrams } from './highlights';
import { netCarbs } from './portions';

export type FactRow = {
  key: string;
  label: string;
  unit: 'g' | 'mg' | 'μg' | 'kcal';
  per100g: number | undefined;
  perServing: number | undefined;
};

const round = (n: number) => Number(n.toFixed(1));

export function nutritionFacts(food: Food): {
  serving: number;
  rows: FactRow[];
} {
  const serving = servingGrams(food);
  const p = food.per100g;
  const m = food.micro100g ?? {};
  const row = (
    key: string,
    label: string,
    unit: FactRow['unit'],
    v: number | undefined,
  ): FactRow => ({
    key,
    label,
    unit,
    per100g: v === undefined ? undefined : round(v),
    perServing: v === undefined ? undefined : round((v * serving) / 100),
  });
  return {
    serving,
    rows: [
      row('kcal', '열량', 'kcal', p.kcal),
      row('protein', '단백질', 'g', p.protein),
      row('netCarbs', '순탄수', 'g', netCarbs(p)),
      row('fiber', '식이섬유', 'g', p.fiber),
      row('fat', '지방', 'g', p.fat),
      row('satFat', '포화지방', 'g', p.satFat),
      row('sodium', '나트륨', 'mg', p.sodium),
      row('cholesterol', '콜레스테롤', 'mg', p.cholesterol),
      row('potassium', '칼륨', 'mg', m.potassium),
      row('calcium', '칼슘', 'mg', m.calcium),
      row('iron', '철분', 'mg', m.iron),
      row('vitaminA', '비타민A', 'μg', m.vitaminA),
      row('vitaminC', '비타민C', 'mg', m.vitaminC),
      row('vitaminD', '비타민D', 'μg', m.vitaminD),
    ],
  };
}
