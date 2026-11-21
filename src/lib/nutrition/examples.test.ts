// Example day plans for three users (Phase 2 check). Sanity checks always run;
// the markdown tables print only with PRINT_EXAMPLES=1:
//   PRINT_EXAMPLES=1 npx vitest run src/lib/nutrition/examples.test.ts --silent=false
import { describe, expect, it } from 'vitest';
import type {
  DayPlan,
  DietStyle,
  MealCombo,
  MealType,
  MicroKey,
  NutrientTargets,
  NutrientTotals,
} from '@/types/nutrition';
import {
  KCAL_FILL_ORDER,
  KCAL_PER_GRAM,
  MICRO_KEYS,
  PROTEIN_GROUP_LABELS,
  type KcalFillStep,
} from './constants';
import { FLAG_MESSAGES, HARD_FROM_FOOD_NOTE } from './flags';
import { comboProteinGroup, generateDayPlan } from './generate';
import {
  EXAMPLE_PROFILES,
  FOODS,
  REF_YEAR,
  SEASONINGS,
  selectAll,
} from './test-fixtures';

const MEAL_LABEL: Record<MealType, string> = {
  breakfast: '아침',
  lunch: '점심',
  dinner: '저녁',
};
const GOAL_LABEL = {
  lose: '감량',
  maintain: '유지',
  gain: '근육 증가',
} as const;
const BASIS_LABEL = { raw: '조리 전', cooked: '조리 후' } as const;

const r0 = (n: number) => String(Math.round(n));
const r1 = (n: number) => String(Number(n.toFixed(1)));

function itemsText(c: MealCombo): string {
  return c.items
    .map(({ food, grams }) => {
      const unit = food.unit
        ? ` = ${r1(grams / food.unit.grams)}${food.unit.label}`
        : '';
      return `${food.name} ${grams}g(${BASIS_LABEL[food.basis]}${unit})`;
    })
    .join(' + ');
}

const useText = (u: MealCombo['oils'][number]) =>
  `${u.seasoning.name} ${u.units}${u.seasoning.unit.label}`;

function oilText(c: MealCombo): string {
  return c.oils.map(useText).join(', ') || '—';
}

/** Free (no-sodium) seasonings first, then the one salty seasoning. */
function seasoningText(c: MealCombo): string {
  const parts: string[] = [];
  if (c.seasonings.free.length > 0) parts.push('자유 양념');
  parts.push(...c.seasonings.picks.map(useText));
  if (c.seasonings.reason === 'NO_SODIUM_BUDGET')
    parts.push('짠 양념 없음(예산 부족)');
  return parts.join(' + ') || '—';
}

const saltySodium = (c: MealCombo) =>
  c.seasonings.picks.reduce(
    (a, u) => a + u.seasoning.perUnit.sodium * u.units,
    0,
  );

type Row = {
  label: string;
  t: NutrientTargets;
  x: NutrientTotals;
  warn: boolean;
  weightKg: number;
};

const share = (g: number, kcalPerG: number, kcal: number) =>
  `${r0((g * kcalPerG * 100) / kcal)}%`;

/** Shares use the kcal actually eaten. Total carbs = net carbs + fiber, counted at 4 kcal/g. */
function nutrientRow({ label, t, x, warn, weightKg }: Row): string {
  return [
    label,
    `${r0(x.kcal)} / ${r0(t.kcal)} (${r0((x.kcal / t.kcal) * 100)}%)${warn ? ' ⚠' : ''}`,
    `${r1(x.protein)} = ${(x.protein / weightKg).toFixed(2)}g/kg · ${share(x.protein, KCAL_PER_GRAM.protein, x.kcal)}`,
    `${r1(x.netCarbs)} / ${r1(x.carbs)} · ${share(x.carbs, KCAL_PER_GRAM.netCarbs, x.kcal)}`,
    `${r1(x.fat)} · ${share(x.fat, KCAL_PER_GRAM.fat, x.kcal)}`,
    `${r1(x.satFat)} · ${share(x.satFat, KCAL_PER_GRAM.fat, x.kcal)}`,
    `${r1(x.fiber)} / ≥${r1(t.fiberMin)}`,
    `${r0(x.sodium)}`,
    `${r0(x.cholesterol)} / ≤${r0(t.cholesterolMax)}`,
  ].join(' | ');
}

const STEP_NO: Partial<Record<KcalFillStep, string>> = {
  proteinBase: '①',
  carbsToLimit: '②',
  fatToStage1: '③',
  proteinToMax: '④',
  fatToStage2: '⑤',
  carbsTopUp: '⑥',
  reportGap: '⑦',
};

const MICRO_LABEL: Record<MicroKey, string> = {
  calcium: '칼슘 (mg)',
  iron: '철 (mg)',
  potassium: '칼륨 (mg)',
  vitaminC: '비타민C (mg)',
  vitaminA: '비타민A (μg RAE)',
  vitaminD: '비타민D (μg)',
};

function renderPlan(label: string, plan: DayPlan): string {
  const p = EXAMPLE_PROFILES.find((e) => e.label === label)!.profile;
  const t = plan.targets;
  const out: string[] = [];
  out.push(
    `### ${label} (${p.sex === 'female' ? '여성' : '남성'} ${REF_YEAR - p.birthYear}세 · ${p.heightCm}cm · 활동 ${p.activityLevel}단계 · ${GOAL_LABEL[p.goal]} · ${p.mealsPerDay}끼)`,
  );
  out.push('');
  out.push(
    `하루 목표: ${r0(t.kcal)}kcal · 단백질 ${r0(t.protein.base)}g(${r1(t.protein.base / p.weightKg)}g/kg, 보충 시 최대 ${r1(t.protein.max / p.weightKg)}g/kg) · 순탄수 기본 ${r0(t.netCarbMax)}g · 총탄수 ${t.totalCarbMin}~${r0(t.totalCarbMax)}g(45%) · 지방 ≤${r0(t.fat.stage2)}g(35%) · 포화지방 <${r1(t.satFatTarget)}g(7%) · 콜레스테롤 ≤${t.cholesterolMax}mg · 식이섬유 ≥${t.fiberMin}g · 나트륨 ≤${t.sodiumMax}mg`,
  );
  out.push('');
  out.push(
    `플래그: ${plan.flags.length ? plan.flags.map((f) => `${f} — "${FLAG_MESSAGES[f]}"`).join(' / ') : '없음'}`,
  );
  out.push('');

  out.push('| 끼니 | 단백질 그룹 | 재료 (중량·기준) | 냉압착 기름 | 양념 |');
  out.push('|---|---|---|---|---|');
  for (const m of plan.meals) {
    const c = m.combos[0];
    out.push(
      `| ${MEAL_LABEL[m.mealType]} | ${PROTEIN_GROUP_LABELS[comboProteinGroup(c)!]} | ${itemsText(c)} | ${oilText(c)} | ${seasoningText(c)} |`,
    );
  }
  out.push('');

  const w = p.weightKg;
  const rows: Row[] = plan.meals.map((m) => ({
    label: MEAL_LABEL[m.mealType],
    t: m.targets,
    x: m.combos[0].totals,
    warn: m.combos[0].kcalWarning,
    weightKg: w,
  }));
  rows.push({
    label: '**하루**',
    t,
    x: plan.totals,
    warn: plan.totals.kcal < t.kcal * 0.8,
    weightKg: w,
  });
  out.push(
    '| | kcal (달성률) | 단백질 g (g/kg · %) | 순탄수 / 총탄수 g · 탄수 % | 지방 g · % | 포화지방 g · % | 식이섬유 g | 나트륨 mg | 콜레스테롤 mg |',
  );
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) out.push(`| ${nutrientRow(r)} |`);
  out.push('');

  out.push(
    `단계별 kcal (채우는 순서: ${KCAL_FILL_ORDER.map((k) => STEP_NO[k]).join(' → ')})`,
  );
  out.push('');
  out.push(
    '| 끼니 | ① 단백질 기본 | ② 탄수 기본 | 채소 | ③ 지방 30% | ④ 단백질 추가 | ⑤ 지방 35% | ⑥ 통곡물·콩 탄수 | 양념 | ⑦ 남은 부족분 |',
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const m of plan.meals) {
    const c = m.combos[0];
    const s = c.kcalByStep;
    out.push(
      `| ${MEAL_LABEL[m.mealType]} | ${[s.proteinBase, s.carbsToLimit, s.veggies, s.fatToStage1, s.proteinToMax, s.fatToStage2, s.carbsTopUp, s.seasonings, c.kcalGap].map(r0).join(' | ')} |`,
    );
  }
  out.push('');

  out.push(
    '미량영양소 (하루 합계 vs KDRI 2020 기준, 원자료에 값이 없는 재료는 0으로 계산)',
  );
  out.push('');
  out.push('| 영양소 | 하루 합계 | KDRI 기준 | 기준 대비 |');
  out.push('|---|---|---|---|');
  for (const k of MICRO_KEYS) {
    const amount = plan.micros[k];
    const ref = t.micros[k];
    const sf = plan.shortfalls.find((x) => x.nutrient === k);
    const short = sf
      ? sf.hardFromFood
        ? ` (부족 — ${HARD_FROM_FOOD_NOTE})`
        : ' (부족)'
      : '';
    out.push(
      `| ${MICRO_LABEL[k]} | ${r1(amount)} | ${ref} | ${r0((amount / ref) * 100)}%${short} |`,
    );
  }
  const free = plan.meals[0].combos[0].seasonings.free
    .map((s) => s.name)
    .join('·');
  out.push('');
  out.push(`자유 양념(나트륨 0, 먼저 권장, 합계 미포함): ${free}`);
  return out.join('\n');
}

/** Day totals only (one row per user) + the micronutrient table (one column per user). */
function renderSummary(items: { label: string; plan: DayPlan }[]): string {
  const out: string[] = [];
  out.push(
    '| 사용자 | kcal (달성률) | 단백질 g/kg | 총탄수 % | 지방 % | 포화지방 % | 나트륨 mg | 플래그 |',
  );
  out.push('|---|---|---|---|---|---|---|---|');
  for (const { label, plan } of items) {
    const p = EXAMPLE_PROFILES.find((e) => e.label === label)!.profile;
    const x = plan.totals;
    out.push(
      `| ${label} | ${r0(x.kcal)} / ${r0(plan.targets.kcal)} (${r0((x.kcal / plan.targets.kcal) * 100)}%) | ${(x.protein / p.weightKg).toFixed(2)} | ${share(x.carbs, KCAL_PER_GRAM.netCarbs, x.kcal)} | ${share(x.fat, KCAL_PER_GRAM.fat, x.kcal)} | ${share(x.satFat, KCAL_PER_GRAM.fat, x.kcal)} | ${r0(x.sodium)} | ${plan.flags.length ? plan.flags.join(', ') : '없음'} |`,
    );
  }
  out.push('');
  out.push(`| 영양소 | ${items.map((i) => i.label).join(' | ')} |`);
  out.push(`|---|${items.map(() => '---').join('|')}|`);
  for (const k of MICRO_KEYS) {
    const cells = items.map(({ plan }) => {
      const amount = plan.micros[k];
      const ref = plan.targets.micros[k];
      const sf = plan.shortfalls.find((x) => x.nutrient === k);
      const note = sf ? ' ⚠ 부족' : '';
      return `${r1(amount)} / ${ref} (${r0((amount / ref) * 100)}%)${note}`;
    });
    out.push(`| ${MICRO_LABEL[k]} | ${cells.join(' | ')} |`);
  }
  out.push('');
  out.push(`비타민D 부족 안내: ${HARD_FROM_FOOD_NOTE}`);
  return out.join('\n');
}

/** Diet-style examples: day totals and one ingredient line per meal. */
const STYLE_EXAMPLES: {
  label: string;
  profileIndex: number;
  styles: DietStyle[];
  styleLabel: string;
}[] = [
  {
    label: '감량 여성 60kg',
    profileIndex: 0,
    styles: ['lowCarb', 'lowSodium'],
    styleLabel: '저탄수+저염',
  },
  {
    label: '유지 남성 75kg',
    profileIndex: 1,
    styles: ['pescatarian'],
    styleLabel: '페스코',
  },
  {
    label: '근육 증가 남성 70kg',
    profileIndex: 2,
    styles: ['highProtein'],
    styleLabel: '고단백',
  },
];

function renderStyleExamples(): string {
  const out: string[] = [];
  const results = STYLE_EXAMPLES.map((e) => ({
    e,
    p: EXAMPLE_PROFILES[e.profileIndex].profile,
    plan: generateDayPlan({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: selectAll(),
      profile: EXAMPLE_PROFILES[e.profileIndex].profile,
      refYear: REF_YEAR,
      conditions: { styles: e.styles },
    }),
  }));
  out.push(
    '| 사용자 · 스타일 | kcal (달성률) | 단백질 g/kg | 총탄수 % | 지방 % | 포화지방 % | 나트륨 mg (상한) | 플래그 |',
  );
  out.push('|---|---|---|---|---|---|---|---|');
  for (const { e, p, plan } of results) {
    const x = plan.totals;
    out.push(
      `| ${e.label} · ${e.styleLabel} | ${r0(x.kcal)} / ${r0(plan.targets.kcal)} (${r0((x.kcal / plan.targets.kcal) * 100)}%) | ${(x.protein / p.weightKg).toFixed(2)} | ${share(x.carbs, KCAL_PER_GRAM.netCarbs, x.kcal)} | ${share(x.fat, KCAL_PER_GRAM.fat, x.kcal)} | ${share(x.satFat, KCAL_PER_GRAM.fat, x.kcal)} | ${r0(x.sodium)} (≤${plan.targets.sodiumMax}) | ${plan.flags.length ? plan.flags.join(', ') : '없음'} |`,
    );
  }
  for (const { e, plan } of results) {
    out.push('');
    out.push(`**${e.label} · ${e.styleLabel}**`);
    for (const m of plan.meals) {
      const c = m.combos[0];
      const oil = c.oils.length ? ` · ${c.oils.map(useText).join(', ')}` : '';
      out.push(
        `- ${MEAL_LABEL[m.mealType]}: ${c.items.map((i) => `${i.food.name} ${i.grams}g`).join(' + ')}${oil}`,
      );
    }
    const short = plan.shortfalls
      .filter((sf) => !sf.hardFromFood)
      .map((sf) => MICRO_LABEL[sf.nutrient]);
    const unmet = plan.unmetTargets.map(
      (u) => `${u.nutrient} ${r0(u.actual)}/${r0(u.target)}`,
    );
    out.push(
      `  - 미량영양소 부족: ${short.length ? short.join(', ') : '없음'} · 목표 미달: ${unmet.length ? unmet.join(', ') : '없음'}`,
    );
  }
  return out.join('\n');
}

describe('example users (PLAN.md Phase 2 check)', () => {
  const plans = EXAMPLE_PROFILES.map(({ label, profile }) => ({
    label,
    plan: generateDayPlan({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: selectAll(),
      profile,
      refYear: REF_YEAR,
    }),
  }));

  it.each(plans)(
    '$label: portions, protein groups, no repeated foods, total carbs 100 g ~ 45% + 2 g, no flag but HIGH_PROTEIN',
    ({ plan }) => {
      expect(plan.reason).toBeUndefined();
      const chosen = plan.meals.map((m) => m.combos[0]);
      for (const c of chosen) {
        for (const { food, grams } of c.items) {
          expect(grams).toBeGreaterThanOrEqual(food.portion.min);
          expect(grams).toBeLessThanOrEqual(food.portion.max);
        }
        expect(c.kcalGap).toBeGreaterThanOrEqual(0);
      }
      const proteins = chosen.map(
        (c) => c.items.find((i) => i.food.category === 'protein')!.food.id,
      );
      expect(new Set(proteins).size).toBe(proteins.length);
      expect(new Set(chosen.map(comboProteinGroup)).size).toBe(3);
      const foods = chosen.flatMap((c) => c.items.map((i) => i.food.id));
      expect(foods.length).toBe(new Set(foods).size);
      expect(plan.totals.carbs).toBeLessThanOrEqual(
        plan.targets.totalCarbMax + 2,
      );
      expect(plan.totals.carbs).toBeGreaterThanOrEqual(100);
      expect(plan.flags.filter((f) => f !== 'HIGH_PROTEIN')).toEqual([]);
      for (const c of chosen) {
        expect(c.seasonings.picks.length).toBeLessThanOrEqual(1);
        expect(saltySodium(c)).toBeLessThanOrEqual(c.seasonings.allowed);
      }
    },
  );

  it('prints the tables when PRINT_EXAMPLES=1 (or only the day summary when =summary)', () => {
    if (process.env.PRINT_EXAMPLES === 'styles') {
      console.log(renderStyleExamples());
      return;
    }
    if (process.env.PRINT_EXAMPLES === 'summary') {
      console.log(renderSummary(plans));
      return;
    }
    if (process.env.PRINT_EXAMPLES !== '1') return;
    console.log(
      plans.map(({ label, plan }) => renderPlan(label, plan)).join('\n\n'),
    );
  });
});
