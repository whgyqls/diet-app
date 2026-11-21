import { describe, expect, it } from 'vitest';
import { FLAG_MESSAGES, HARD_FROM_FOOD_NOTE, HEALTH_FLAGS } from './flags';

describe('flag texts', () => {
  it('has a non-empty message for every health flag', () => {
    for (const f of HEALTH_FLAGS)
      expect(FLAG_MESSAGES[f].length).toBeGreaterThan(0);
  });

  it('uses the approved wording for the high-fat, saturated-fat and low-sodium notes', () => {
    expect(FLAG_MESSAGES.HIGH_FAT_MOSTLY_UNSAT).toBe(
      '지방 비율이 일반 권고(35%)보다 높지만 대부분 불포화지방이에요.',
    );
    expect(FLAG_MESSAGES.HIGH_SAT_FAT).toBe(
      '포화지방이 하루 칼로리의 10% 이상이에요. 지방이 많은 고기나 유제품을 줄이면 낮출 수 있어요.',
    );
    expect(FLAG_MESSAGES.LOW_SODIUM).toContain('1,500mg');
  });

  it('has the vitamin D hard-from-food note', () => {
    expect(HARD_FROM_FOOD_NOTE).toBe('음식만으로는 채우기 어려운 영양소예요');
  });
});
