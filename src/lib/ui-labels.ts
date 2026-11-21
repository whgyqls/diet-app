// Korean screen copy (not nutrition constants). No efficacy claims.
import type { Food } from '@/types/food';
import type { ActivityLevel, DietStyle, Goal, Sex } from '@/types/nutrition';

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
export const EXCLUDED_BY_STYLE_TEXT = '이 스타일에서는 추천에서 제외돼요';
export const DISCLAIMER =
  '일반 성인 기준의 참고용이며 의료적 조언이 아닙니다. 신장 질환, 임신, 당뇨 약 복용 중이면 전문가와 상의하세요.';
