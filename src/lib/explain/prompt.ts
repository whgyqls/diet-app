// The messages sent to the AI. Only the canonical input goes in: names, grams, totals, seasonings, goal kind.
import { BASIS_SHORT, GOAL_LABELS } from '@/lib/ui-labels';
import type { ExplainInput } from './types';

export const SYSTEM_PROMPT = [
  '너는 식단 앱의 설명 문장을 쓰는 도우미야. 계산은 앱이 이미 끝냈고, 너는 주어진 결과를 짧게 풀어서 설명만 해.',
  '규칙:',
  '- 한국어로 1~2문장, 200자 이내.',
  '- 숫자는 아래 입력에 있는 값만 그대로 복사해서 쓰고, 반올림하거나 합치거나 새 숫자를 만들지 마. 조리 시간·온도 같은 숫자도 쓰지 마.',
  '- 병이나 건강 상태의 예방·치료·개선, 혈당·대사, "효과", "개선", "도움이 된다" 같은 효능 표현은 쓰지 마.',
  '- 레시피나 조리 단계를 만들지 말고, 어떤 재료가 어떤 역할(단백질·탄수화물·식이섬유·지방원)을 하는지와 간단한 섭취 팁만 말해.',
  '- 반드시 JSON 한 개만 출력해: {"text":"설명 문장"}',
].join('\n');

const line = (s: string) => `- ${s}`;

export function userPrompt(input: ExplainInput): string {
  const t = input.totals;
  return [
    `목표: ${GOAL_LABELS[input.goal]}`,
    '재료:',
    ...input.items.map((i) =>
      line(`${i.name} ${i.grams}g (${BASIS_SHORT[i.basis]} 기준)`),
    ),
    ...(input.oils.length > 0
      ? [
          '조리용 기름:',
          ...input.oils.map((o) => line(`${o.name} ${o.grams}g`)),
        ]
      : []),
    '양념 권장량:',
    ...input.seasonings.map((s) => line(`${s.name} ${s.units}${s.unit}`)),
    ...(input.free.length > 0
      ? [line(`자유롭게: ${input.free.join(', ')}`)]
      : []),
    '끼니 영양 합계:',
    line(
      `${t.kcal}kcal, 단백질 ${t.protein}g, 총탄수화물 ${t.carbs}g, 지방 ${t.fat}g, 포화지방 ${t.satFat}g, 식이섬유 ${t.fiber}g, 나트륨 ${t.sodium}mg`,
    ),
  ].join('\n');
}
