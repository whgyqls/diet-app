// User-facing text for target and health flags (PLAN.md 4.3, 4.4). Shown as is in Phase 3/4 screens.
import type { FlagCode, HealthFlagCode } from '@/types/nutrition';

/** Shown next to a micronutrient shortfall that food alone can hardly cover (vitamin D). */
export const HARD_FROM_FOOD_NOTE = '음식만으로는 채우기 어려운 영양소예요';

export const FLAG_MESSAGES: Record<FlagCode, string> = {
  HIGH_PROTEIN:
    '신장 질환이 있거나, 질환·복용 중인 약 때문에 단백질 섭취 제한을 권고받았다면 이 설정을 따르기 전에 의사와 상담하세요.',
  LOW_SODIUM:
    '나트륨 충분섭취량(1,500mg)보다 낮은 설정이에요. 탄수화물을 적게 먹으면 나트륨 손실이 늘 수 있어요. 어지럼·피로가 있으면 설정을 높이세요.',
  LOW_NET_CARB: '당뇨약을 복용 중이거나 임신·수유 중이라면 의사와 상담하세요.',
  HIGH_FAT_MOSTLY_UNSAT:
    '지방 비율이 일반 권고(35%)보다 높지만 대부분 불포화지방이에요.',
  HIGH_SAT_FAT:
    '포화지방이 하루 칼로리의 10% 이상이에요. 지방이 많은 고기나 유제품을 줄이면 낮출 수 있어요.',
  KCAL_BELOW_FLOOR:
    '하루 칼로리가 안전 하한(여성 1,200kcal / 남성 1,500kcal)보다 낮은 설정이에요.',
  PROTEIN_BELOW_MIN: '단백질이 성인 권장섭취량(0.9g/kg)보다 낮은 설정이에요.',
  PROTEIN_CLAMPED_TO_MAX:
    '단백질은 체중 1kg당 2.0g까지만 설정할 수 있어서 2.0g/kg으로 맞췄어요.',
  SODIUM_CLAMPED_TO_MAX:
    '나트륨 상한은 2,000mg보다 높게 설정할 수 없어서 2,000mg으로 맞췄어요.',
};

export const HEALTH_FLAGS: readonly HealthFlagCode[] = [
  'HIGH_PROTEIN',
  'LOW_SODIUM',
  'LOW_NET_CARB',
  'HIGH_FAT_MOSTLY_UNSAT',
  'HIGH_SAT_FAT',
];
