// Korean screen copy (not nutrition constants). No efficacy claims.
import type { Food } from '@/types/food';
import type {
  ActivityLevel,
  DietStyle,
  Goal,
  MealType,
  Sex,
} from '@/types/nutrition';

export const STYLE_ORDER: DietStyle[] = [
  'lowCarb',
  'lowSodium',
  'veggieForward',
  'highProtein',
  'pescatarian',
  'lactoOvo',
];

export const STYLE_INFO: Record<DietStyle, { label: string; desc: string }> = {
  lowCarb: { label: '저탄수', desc: '탄수화물 비율을 낮추고 지방원을 더 써요' },
  lowSodium: { label: '저염', desc: '나트륨 상한 1,500mg, 짠 양념은 적게' },
  veggieForward: {
    label: '채소 위주',
    desc: '식이섬유 40g, 끼니마다 채소 2가지',
  },
  highProtein: { label: '고단백', desc: '단백질 목표를 체중 1kg당 1.8g으로' },
  pescatarian: {
    label: '페스코',
    desc: '닭·소·돼지·오리 고기는 빼고 추천해요',
  },
  lactoOvo: {
    label: '락토-오보 채식',
    desc: '고기·생선·해산물은 빼고 추천해요',
  },
};

export const SEX_LABELS: Record<Sex, string> = { female: '여성', male: '남성' };
export const GOAL_LABELS: Record<Goal, string> = {
  lose: '감량',
  maintain: '유지',
  gain: '근육 증가',
};
export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  1: '거의 안 움직임',
  2: '가벼운 활동 (주 1~3회)',
  3: '보통 (주 3~5회)',
  4: '활발함 (주 6~7회)',
  5: '매우 활발함 (하루 2회 등)',
};

export const STEPS: {
  key: Food['category'] | 'seasoning';
  label: string;
}[] = [
  { key: 'protein', label: '단백질' },
  { key: 'carb', label: '탄수화물' },
  { key: 'fiber', label: '식이섬유' },
  { key: 'fat', label: '지방원' },
  { key: 'seasoning', label: '양념' },
];

export const BASIS_LABELS = { raw: '생(조리 전) 기준', cooked: '조리 후 기준' };

/** Fat step filter chips: whole fat foods vs cold-pressed oils. */
export const FAT_FILTER_OIL = 'oil';
export const FAT_FILTERS = [
  { key: 'whole', label: '견과·씨앗·아보카도' },
  { key: FAT_FILTER_OIL, label: '기름' },
] as const;
export const OIL_CARD_LABEL = '조리에도 쓸 수 있어요';

/** How long the "되돌리기" toast stays after a reset or a kit load. */
export const UNDO_TOAST_MS = 10_000;
export const EXCLUDED_BY_STYLE_TEXT = '이 스타일에서는 추천에서 제외돼요';
export const DISCLAIMER =
  '일반 성인 기준의 참고용이며 의료적 조언이 아닙니다. 신장 질환, 임신, 당뇨 약 복용 중이면 전문가와 상의하세요.';

// ---- Plan screen (/plan) ----
export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '아침',
  lunch: '점심',
  dinner: '저녁',
};
export const BAR_LABELS = {
  kcal: '칼로리',
  protein: '단백질',
  carbs: '총탄수화물',
  fat: '지방',
  satFat: '포화지방',
  fiber: '식이섬유',
  sodium: '나트륨',
} as const;
/** Short basis labels on ingredient rows. */
export const BASIS_SHORT = { raw: '생것', cooked: '조리 후' } as const;
export const UNMET_LABELS = {
  protein: '단백질',
  fiber: '식이섬유',
  kcal: '칼로리',
} as const;
/** Why the foods cannot fill the kcal target (kcalGap.ts) and what to do about it. */
export const KCAL_GAP_REASON_TEXT = {
  NO_CARB_FOOD:
    '탄수화물 재료를 고르지 않았어요. 현미밥·귀리·고구마 같은 재료를 고르면 더 채울 수 있어요.',
  NO_FAT_SOURCE:
    '견과·씨앗·아보카도를 고르지 않았어요. 고르면 지방으로 더 채울 수 있어요.',
  NO_OIL:
    '기름을 고르지 않았어요. 올리브유·들기름 같은 냉압착 기름을 고르면 조금 더 채울 수 있어요.',
  LOW_CARB_STYLE:
    '저탄수 스타일의 총탄수화물 상한을 넘지 않게 하다 보니 더 채울 수 없어요. 스타일을 바꾸면 더 채울 수 있어요.',
  USER_CARB_LIMIT: '순탄수 목표를 직접 정해서 그 이상 늘리지 않아요.',
  PORTION_LIMITS:
    '한 끼에 단백질은 1가지, 채소는 1~2가지까지이고 재료마다 1회 최대 분량과 단백질 상한이 있어요.',
} as const;
export const SEASONING_REASON_TEXT = {
  NO_SALTY_SELECTED: '짠 양념을 고르지 않아 권장량이 없어요',
  NO_SODIUM_BUDGET: '이 끼니는 나트륨 여유가 없어 짠 양념은 권하지 않아요',
} as const;

// ---- Plan screen: swap, lock, compare, save, notices (Phase 4b) ----
export const NOTICE_TEXT = {
  SLOT_FULL: '식이섬유 재료는 최대 2개까지 고정할 수 있어요',
  TOO_MANY_FIBERS: '이 끼니는 식이섬유 재료를 더 고정할 수 없어요',
  COMPARE_FULL: '비교는 최대 3개까지 할 수 있어요',
  LOCK_INFEASIBLE:
    '이 고정으로는 만들 수 있는 조합이 없어요. 직전 고정 상태로 되돌렸어요',
  EXHAUSTED: '더 이상 새 조합이 없어요',
  REROLL_ERROR: '다시 추천하지 못했어요. 잠시 후 다시 시도해 주세요',
  SWAP_DUPLICATE: '이미 목록에 있는 조합이에요',
} as const;

/**
 * What a deleted account takes with it, as the delete dialog (/settings) and the privacy page (/privacy) both say
 * it. One text so the two cannot drift apart (checked by tests/e2e/privacy.spec.ts).
 */
export const ACCOUNT_DATA_TEXT =
  '프로필, 재료 선택, 내 재료 세트, 저장한 조합(★)';
