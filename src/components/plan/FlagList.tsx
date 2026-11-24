'use client';

import { HARD_FROM_FOOD_NOTE, MICRO_LABELS_KO } from '@/lib/nutrition/flags';
import { KCAL_GAP_REASON_TEXT, UNMET_LABELS } from '@/lib/ui-labels';
import type { DayPlan } from '@/types/nutrition';

const unitOf = (n: 'protein' | 'fiber' | 'kcal') =>
  n === 'kcal' ? 'kcal' : 'g';

/** Warnings (text + source, collapsible), missing nutrients and targets the foods could not reach. */
export function FlagList({ plan }: { plan: DayPlan }) {
  const { flagDetails, shortfalls, unmetTargets, kcalFill } = plan;
  if (
    flagDetails.length + shortfalls.length + unmetTargets.length === 0 &&
    !kcalFill
  )
    return null;
  return (
    <section aria-label="안내와 경고" className="space-y-3 px-4 pt-4">
      {flagDetails.length > 0 && (
        <ul className="space-y-2">
          {flagDetails.map((f) => (
            <li key={f.code}>
              <details className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                  {f.message}
                </summary>
                {f.detail && <p className="mt-1 text-sm">{f.detail}</p>}
                <p className="mt-1 text-xs">근거: {f.source}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
      {kcalFill && (
        <div
          role="note"
          className="rounded-lg border border-neutral-300 p-3 text-sm dark:border-neutral-600"
        >
          <p className="font-medium">칼로리를 목표만큼 채우지 못했어요</p>
          {kcalFill.cause === 'SELECTION' ? (
            <>
              <p className="mt-1">
                고른 재료와 설정으로는 목표의 약{' '}
                {Math.floor(kcalFill.ceilingRatio * 100)}%까지만 채울 수 있어요.
                (지금 식단: 약 {Math.round(kcalFill.ratio * 100)}%)
              </p>
              <ul className="mt-1 list-disc pl-5">
                {kcalFill.reasons.map((r) => (
                  <li key={r}>{KCAL_GAP_REASON_TEXT[r]}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1">
              다른 영양 기준(탄수화물·지방·포화지방·나트륨 등)을 함께 맞추느라
              목표의 약 {Math.round(kcalFill.ratio * 100)}%만 채웠어요. 고른
              재료로는 최대 약 {Math.floor(kcalFill.ceilingRatio * 100)}%까지
              채울 수 있어요.
            </p>
          )}
        </div>
      )}
      {unmetTargets.length > 0 && (
        <div className="rounded-lg border border-neutral-300 p-3 text-sm dark:border-neutral-600">
          <p className="font-medium">고른 재료로는 못 채운 목표</p>
          <ul className="mt-1 list-disc pl-5">
            {unmetTargets.map((u) => (
              <li key={u.nutrient}>
                {UNMET_LABELS[u.nutrient]}: 목표 {Math.round(u.target)}
                {unitOf(u.nutrient)} 중 {Math.round(u.actual)}
                {unitOf(u.nutrient)} ({Math.round(u.short)}
                {unitOf(u.nutrient)} 부족)
              </li>
            ))}
          </ul>
        </div>
      )}
      {shortfalls.length > 0 && (
        <div className="rounded-lg border border-neutral-300 p-3 text-sm dark:border-neutral-600">
          <p className="font-medium">부족한 영양소</p>
          <ul className="mt-1 list-disc pl-5">
            {shortfalls.map((s) => (
              <li key={s.nutrient}>
                {MICRO_LABELS_KO[s.nutrient]}: 권장 기준의{' '}
                {Math.round(s.ratio * 100)}%
                {s.hardFromFood && (
                  <span className="block text-xs text-neutral-600 dark:text-neutral-400">
                    {HARD_FROM_FOOD_NOTE}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
