// Food card info (PLAN.md 3.2): one key line per 100 g and up to two pro/con chips.
import type { Food, Micro100g } from '@/types/food';
import { BONUS_BADGE_LABELS, bonusBadges } from './badges';
import {
  DAILY_VALUES,
  HIGH_FAT_PROTEIN_MIN_PER100G,
  HIGH_SODIUM_MIN_PER100G,
  LOW_FAT_MAX_PER100G,
  MAX_CHIPS,
  MICRO_CHIP_MIN_DV_RATIO,
  SERVING_DEFAULT_G,
} from './constants';
import { netCarbs } from './portions';

type MicroKey = keyof typeof DAILY_VALUES;

const MICRO_LABELS: Record<MicroKey, string> = {
  potassium: '칼륨',
  calcium: '칼슘',
  iron: '철분',
  vitaminA: '비타민A',
  vitaminC: '비타민C',
};

export type ChipCode =
  | 'HIGH_SODIUM'
  | 'HIGH_FAT'
  | 'PROTEIN_RICH'
  | 'FIBER_RICH'
  | 'LOW_FAT'
  | `MICRO_${MicroKey}`;
export type Chip = {
  kind: 'caution' | 'bonus' | 'pro';
  code: ChipCode;
  label: string;
};

export type KeyLinePart = { label: string; value: number; unit: 'g' | 'kcal' };
export type KeyLine = { parts: KeyLinePart[]; micro?: MicroKey; text: string };

export type FoodHighlights = {
  serving: number;
  keyLine: KeyLine;
  chips: Chip[];
};

/** One serving: the food's unit if it has one, else 100 g clamped to its portion range. */
export function servingGrams(food: Food): number {
  if (food.unit) return food.unit.grams;
  return Math.min(
    food.portion.max,
    Math.max(food.portion.min, SERVING_DEFAULT_G),
  );
}

/** Micronutrients reaching the chip threshold in one serving, highest % daily value first. */
function richMicros(food: Food): MicroKey[] {
  const micro: Micro100g = food.micro100g ?? {};
  const serving = servingGrams(food);
  return (Object.keys(DAILY_VALUES) as MicroKey[])
    .map((k) => ({
      k,
      ratio: ((micro[k] ?? 0) * serving) / 100 / DAILY_VALUES[k],
    }))
    .filter((x) => x.ratio >= MICRO_CHIP_MIN_DV_RATIO)
    .sort((a, b) => b.ratio - a.ratio)
    .map((x) => x.k);
}

/** 23 -> "23", 18.70000001 -> "18.7" */
function fmt(n: number, decimals = 1): string {
  return String(Number(n.toFixed(decimals)));
}

function keyLine(food: Food): KeyLine {
  const p = food.per100g;
  const g = (label: string, value: number): KeyLinePart => ({
    label,
    value,
    unit: 'g',
  });
  const kcal: KeyLinePart = { label: '', value: p.kcal, unit: 'kcal' };
  const parts: KeyLinePart[] = {
    protein: [g('단백질', p.protein), g('지방', p.fat), kcal],
    carb: [g('순탄수', netCarbs(p)), g('식이섬유', p.fiber), kcal],
    fiber: [g('식이섬유', p.fiber), kcal],
    fat: [g('지방', p.fat), g('식이섬유', p.fiber), kcal],
  }[food.category];
  const micro = food.category === 'fiber' ? richMicros(food)[0] : undefined;
  const texts = parts.map((x) =>
    x.unit === 'kcal'
      ? `${fmt(x.value, 0)}kcal`
      : `${x.label} ${fmt(x.value)}g`,
  );
  if (micro) texts.push(`${MICRO_LABELS[micro]} 많음`);
  return { parts, micro, text: texts.join(' · ') };
}

export function foodHighlights(food: Food): FoodHighlights {
  const p = food.per100g;
  const line = keyLine(food);

  const cautions: Chip[] = [];
  if (p.sodium >= HIGH_SODIUM_MIN_PER100G)
    cautions.push({
      kind: 'caution',
      code: 'HIGH_SODIUM',
      label: '나트륨 많은 편',
    });
  if (food.category === 'protein' && p.fat >= HIGH_FAT_PROTEIN_MIN_PER100G)
    cautions.push({ kind: 'caution', code: 'HIGH_FAT', label: '지방 많은 편' });

  const bonus: Chip[] = bonusBadges(food).map((b) => ({
    kind: 'bonus',
    code: b,
    label: BONUS_BADGE_LABELS[b],
  }));

  const pros: Chip[] = [];
  if (food.category === 'protein' && p.fat <= LOW_FAT_MAX_PER100G)
    pros.push({ kind: 'pro', code: 'LOW_FAT', label: '저지방' });
  for (const k of richMicros(food)) {
    if (k !== line.micro)
      pros.push({
        kind: 'pro',
        code: `MICRO_${k}`,
        label: `${MICRO_LABELS[k]} 많음`,
      });
  }

  return {
    serving: servingGrams(food),
    keyLine: line,
    chips: [...cautions.slice(0, 1), ...bonus, ...pros].slice(0, MAX_CHIPS),
  };
}
