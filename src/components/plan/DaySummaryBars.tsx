'use client';

import { dayBars } from '@/lib/nutrition/summary';
import { BAR_LABELS } from '@/lib/ui-labels';
import type { DayPlan } from '@/types/nutrition';

/** Day total vs target. Numbers come from dayBars(); this only draws them. */
export function DaySummaryBars({ plan }: { plan: DayPlan }) {
  return (
    <section aria-label="하루 합계" className="px-4 pt-4">
      <h2 className="mb-2 text-base font-bold">하루 합계 / 목표</h2>
      <ul className="space-y-2">
        {dayBars(plan).map((b) => {
          const width = Math.min(100, Math.round(b.ratio * 100));
          return (
            <li key={b.key}>
              <div className="flex justify-between text-sm">
                <span>
                  {BAR_LABELS[b.key]}
                  <span className="ml-1 text-xs text-neutral-500">
                    {b.kind === 'limit' ? '(상한)' : '(목표)'}
                  </span>
                </span>
                <span className={b.over ? 'font-semibold text-red-600' : ''}>
                  {b.actual.toLocaleString()} / {b.target.toLocaleString()}
                  {b.unit}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={BAR_LABELS[b.key]}
                aria-valuemin={0}
                aria-valuemax={b.target}
                aria-valuenow={b.actual}
                className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
              >
                <div
                  className={`h-full ${b.over ? 'bg-red-500' : 'bg-emerald-600'}`}
                  style={{ width: `${width}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
