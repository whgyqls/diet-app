// All warnings in one place (PLAN.md 4.3, 4.4): text, source, and the calculation from the final values.
// Pure functions. `setting` flags come from the targets/settings, `intake` flags from what the plan provides.
import type {
  DayTargets,
  Flag,
  FlagCode,
  HealthFlagCode,
  MicroKey,
  NutrientTotals,
  Profile,
} from '@/types/nutrition';
import {
  CHOLESTEROL_DAY_MAX_MG,
  HIGH_FAT_WARN_RATIO,
  HIGH_PROTEIN_WARN_PER_KG,
  KCAL_FLOOR,
  KCAL_PER_GRAM,
  LOW_NET_CARB_WARN_G,
  LOW_SODIUM_WARN_MG,
  MEAL_KCAL_WARN_RATIO,
  MICROS_HARD_FROM_FOOD,
  MICRO_KEYS,
  MICRO_SHORTFALL_RATIO,
  SAT_FAT_KCAL_RATIO_MAX,
  TOTAL_CARB_DAY_MIN_G,
} from './constants';

/** Shown next to a micronutrient shortfall that food alone can hardly cover (vitamin D). */
export const HARD_FROM_FOOD_NOTE = '음식만으로는 채우기 어려운 영양소예요';

export const FLAG_MESSAGES: Record<FlagCode, string> = {
  HIGH_PROTEIN:
    '신장 질환이 있거나, 질환·복용 중인 약 때문에 단백질 섭취 제한을 권고받았다면 이 설정을 따르기 전에 의사와 상담하세요.',
  LOW_SODIUM:
    '나트륨 충분섭취량(1,500mg)보다 낮은 설정이에요. 탄수화물을 적게 먹으면 나트륨 손실이 늘 수 있어요. 어지럼·피로가 있으면 설정을 높이세요.',
  LOW_NET_CARB: '당뇨약을 복용 중이거나 임신·수유 중이라면 의사와 상담하세요.',
  LOW_TOTAL_CARB:
    '총탄수화물이 하루 100g(평균필요량)보다 적어요. 어지럼·피로가 있으면 탄수화물을 늘리세요.',
  HIGH_FAT_MOSTLY_UNSAT:
    '지방 비율이 일반 권고(35%)보다 높지만 대부분 불포화지방이에요.',
  HIGH_FAT:
    '지방 비율이 일반 권고(35%)보다 높아요. 포화지방이 많은 재료를 줄이면 낮출 수 있어요.',
  HIGH_SAT_FAT:
    '포화지방이 하루 칼로리의 10% 이상이에요. 지방이 많은 고기나 유제품을 줄이면 낮출 수 있어요.',
  HIGH_CHOLESTEROL:
    '콜레스테롤이 하루 300mg을 넘어요. 달걀·오징어·새우 같은 재료를 줄이면 낮출 수 있어요.',
  LOW_KCAL:
    '고른 재료와 설정으로는 목표 칼로리의 80%를 채우지 못했어요. 재료를 더 고르거나 스타일을 바꿔 보세요.',
  MICRO_SHORTFALL: '일부 영양소가 권장 기준의 90%보다 적어요.',
  KCAL_BELOW_FLOOR:
    '하루 칼로리가 안전 하한(여성 1,200kcal / 남성 1,500kcal)보다 낮아요.',
  PROTEIN_BELOW_MIN: '단백질이 성인 권장섭취량(0.9g/kg)보다 낮은 설정이에요.',
  PROTEIN_CLAMPED_TO_MAX:
    '단백질은 체중 1kg당 2.0g까지만 설정할 수 있어서 2.0g/kg으로 맞췄어요.',
  SODIUM_CLAMPED_TO_MAX:
    '나트륨 상한은 2,000mg보다 높게 설정할 수 없어서 2,000mg으로 맞췄어요.',
};

/** Where each warning's threshold comes from (PLAN.md 4.0, 4.1, 4.1-2, 4.1-3). */
export const FLAG_SOURCES: Record<FlagCode, string> = {
  HIGH_PROTEIN:
    'Morton 외 2018 (Br J Sports Med), ACSM·AND·DC 공동 입장 2016, ISSN 2017',
  LOW_SODIUM: 'KDRI 2020 나트륨 충분섭취량 1,500mg',
  LOW_NET_CARB: '앱 기준 (순탄수 하루 50g 미만 안내)',
  LOW_TOTAL_CARB: 'KDRI 2020 탄수화물 평균필요량 100g',
  HIGH_FAT_MOSTLY_UNSAT: 'IOM 2005 지방 에너지적정비율 상한 35%',
  HIGH_FAT: 'IOM 2005 지방 에너지적정비율 상한 35%',
  HIGH_SAT_FAT: 'WHO 2023, 미국 식생활지침 2020–2025 (포화지방 10% 미만)',
  HIGH_CHOLESTEROL: 'KDRI 2020 콜레스테롤 300mg 미만',
  LOW_KCAL: '앱 기준 (목표 칼로리의 80%)',
  MICRO_SHORTFALL: 'KDRI 2020 권장섭취량·충분섭취량의 90%',
  KCAL_BELOW_FLOOR: '앱 안전 하한 (여성 1,200 / 남성 1,500kcal)',
  PROTEIN_BELOW_MIN: 'KDRI 2020 단백질 권장섭취량 약 0.91g/kg',
  PROTEIN_CLAMPED_TO_MAX: '앱 단백질 상한 2.0g/kg',
  SODIUM_CLAMPED_TO_MAX: 'WHO 2012 나트륨 2,000mg 미만',
};

export const HEALTH_FLAGS: readonly HealthFlagCode[] = [
  'HIGH_PROTEIN',
  'LOW_SODIUM',
  'LOW_NET_CARB',
  'LOW_TOTAL_CARB',
  'HIGH_FAT_MOSTLY_UNSAT',
  'HIGH_FAT',
  'HIGH_SAT_FAT',
  'HIGH_CHOLESTEROL',
  'LOW_KCAL',
  'MICRO_SHORTFALL',
];

export const MICRO_LABELS_KO: Record<MicroKey, string> = {
  calcium: '칼슘',
  iron: '철',
  potassium: '칼륨',
  vitaminC: '비타민C',
  vitaminA: '비타민A',
  vitaminD: '비타민D',
};

/** Setting notices produced while the targets are built (clamps, values below a minimum). */
const SETTING_NOTICES: readonly FlagCode[] = [
  'PROTEIN_BELOW_MIN',
  'PROTEIN_CLAMPED_TO_MAX',
  'SODIUM_CLAMPED_TO_MAX',
];

export type FlagInput = {
  profile: Profile;
  targets: DayTargets;
  /** Setting notices from calcDayTargets (clamped or too-low user values). */
  settingFlags: readonly FlagCode[];
  /** What the plan provides per day. Without it only setting-based warnings are computed. */
  intake?: { totals: NutrientTotals; micros: Record<MicroKey, number> };
};

/**
 * Every warning for the final values, in a fixed order. Targets-only calls (no intake) give the
 * setting-based ones; with an intake, intake-based checks use what is actually eaten.
 */
export function computeFlags(input: FlagInput): Flag[] {
  const { profile, targets, settingFlags, intake } = input;
  const out: Flag[] = [];
  const add = (code: FlagCode, basis: Flag['basis'], detail?: string) =>
    out.push({
      code,
      message: FLAG_MESSAGES[code],
      source: FLAG_SOURCES[code],
      basis,
      ...(detail ? { detail } : {}),
    });
  const totals = intake?.totals;
  const basis: Flag['basis'] = totals ? 'intake' : 'setting';
  const fatShare = (g: number) =>
    totals && totals.kcal > 0 ? (g * KCAL_PER_GRAM.fat) / totals.kcal : 0;

  // 1. setting notices (clamps, below-minimum) and the kcal floor
  for (const code of SETTING_NOTICES)
    if (settingFlags.includes(code)) add(code, 'setting');
  if (settingFlags.includes('KCAL_BELOW_FLOOR'))
    add('KCAL_BELOW_FLOOR', 'setting');
  else if (totals && totals.kcal < KCAL_FLOOR[profile.sex])
    add('KCAL_BELOW_FLOOR', 'intake');

  // 2. protein
  const protein = totals ? totals.protein : targets.protein.base;
  if (protein > profile.weightKg * HIGH_PROTEIN_WARN_PER_KG)
    add('HIGH_PROTEIN', basis);

  // 3. carbs
  const totalCarb = totals ? totals.carbs : targets.totalCarbMax;
  if (totalCarb < TOTAL_CARB_DAY_MIN_G) add('LOW_TOTAL_CARB', basis);
  const netCarb = totals ? totals.netCarbs : targets.netCarbMax;
  if (netCarb < LOW_NET_CARB_WARN_G) add('LOW_NET_CARB', basis);

  // 4. fat and saturated fat (shares of the kcal actually eaten)
  if (totals && fatShare(totals.fat) > HIGH_FAT_WARN_RATIO)
    add(
      fatShare(totals.satFat) > SAT_FAT_KCAL_RATIO_MAX
        ? 'HIGH_FAT'
        : 'HIGH_FAT_MOSTLY_UNSAT',
      'intake',
    );
  if (totals && fatShare(totals.satFat) > SAT_FAT_KCAL_RATIO_MAX)
    add('HIGH_SAT_FAT', 'intake');

  // 5. sodium is about the cap the user (or a style) set, not about what is eaten
  if (targets.sodiumMax < LOW_SODIUM_WARN_MG) add('LOW_SODIUM', 'setting');

  // 6. cholesterol, kcal, micronutrients
  if (totals && totals.cholesterol > CHOLESTEROL_DAY_MAX_MG)
    add('HIGH_CHOLESTEROL', 'intake');
  if (totals && totals.kcal < targets.kcal * MEAL_KCAL_WARN_RATIO)
    add('LOW_KCAL', 'intake');
  if (intake) {
    const short = MICRO_KEYS.filter(
      (k) =>
        !MICROS_HARD_FROM_FOOD.includes(k) &&
        intake.micros[k] < targets.micros[k] * MICRO_SHORTFALL_RATIO,
    );
    if (short.length > 0)
      add(
        'MICRO_SHORTFALL',
        'intake',
        short.map((k) => MICRO_LABELS_KO[k]).join(', '),
      );
  }
  return out;
}
