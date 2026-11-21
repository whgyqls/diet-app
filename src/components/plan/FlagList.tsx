'use client';

import { HARD_FROM_FOOD_NOTE, MICRO_LABELS_KO } from '@/lib/nutrition/flags';
import { UNMET_LABELS } from '@/lib/ui-labels';
import type { DayPlan } from '@/types/nutrition';

const unitOf = (n: 'protein' | 'fiber' | 'kcal') =>
  n === 'kcal' ? 'kcal' : 'g';

/** Warnings (text + source, collapsible), missing nutrients and targets the foods could not reach. */
export function FlagList({ plan }: { plan: DayPlan }) {
  const { flagDetails, shortfalls, unmetTargets } = plan;
  if (flagDetails.length + shortfalls.length + unmetTargets.length === 0)
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
