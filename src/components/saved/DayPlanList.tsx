'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FOODS } from '@/lib/data/load';
import { isFoodExcludedByStyles } from '@/lib/nutrition/styleExclusion';
import { dateLabel, type SavedDayPlan } from '@/lib/plan/dayPlans';
import { includeFromDayPlan } from '@/lib/plan/dayPlanInclude';
import { parseProfile } from '@/lib/profile';
import { useAppStore } from '@/lib/store/appStore';
import { useDayPlans } from '@/lib/plan/useDayPlans';
import { BASIS_SHORT, DAY_PLAN_TEXT as T, MEAL_LABELS } from '@/lib/ui-labels';

const buttonClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg px-4 font-semibold';

/** "날짜별 식단": the day plans saved from /plan, newest date first, with delete. */
export function DayPlanList() {
  const { status, list, refresh, remove } = useDayPlans();
  const router = useRouter();
  const app = useAppStore();
  const profile = parseProfile(app.profile);
  const [confirmDate, setConfirmDate] = useState<string | null>(null);
  const [confirmIncludeDate, setConfirmIncludeDate] = useState<string | null>(
    null,
  );
  const [failed, setFailed] = useState(false);

  const del = (date: string) => {
    setConfirmDate(null);
    setFailed(false);
    remove(date).catch(() => setFailed(true));
  };

  // The foods of that day become the "must include" foods and the recommendation screen opens. What cannot be
  // taken over (not selected now, left out by a style, an oil, over the limit, unknown) is told there.
  const takeOverFoods = (plan: SavedDayPlan['plan']) => {
    setConfirmIncludeDate(null);
    if (!profile) return;
    const { ids, skipped } = includeFromDayPlan(plan, {
      selection: app.selection,
      foods: FOODS,
      isExcluded: (f) => isFoodExcludedByStyles(f, app.styles, profile.goal),
      mealsPerDay: profile.mealsPerDay,
    });
    app.dropIncludes(ids, skipped);
    router.push('/plan');
  };
  const askInclude = (p: SavedDayPlan) =>
    app.includeFoods.length > 0
      ? setConfirmIncludeDate(p.date)
      : takeOverFoods(p.plan);

  return (
    <section aria-label={T.listTitle} className="space-y-3 px-4 pb-8">
      <h2 className="text-base font-bold">{T.listTitle}</h2>
      {status === 'loading' && <p role="status">불러오는 중…</p>}
      {status === 'error' && (
        <div className="space-y-3" role="alert">
          <p className="font-medium">{T.loadFailed}</p>
          <button
            type="button"
            onClick={refresh}
            className={`${buttonClass} bg-emerald-600 text-white`}
          >
            {T.retry}
          </button>
        </div>
      )}
      {status === 'ready' && list.length === 0 && (
        <p
          data-testid="day-plans-empty"
          className="text-sm text-neutral-600 dark:text-neutral-400"
        >
          {T.empty}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
          {T.deleteFailed}
        </p>
      )}
      {status === 'ready' && list.length > 0 && (
        <ul className="space-y-3">
          {list.map((p) => (
            <li key={p.date}>
              <DayPlanCard
                item={p}
                confirming={confirmDate === p.date}
                onAskDelete={() => setConfirmDate(p.date)}
                onCancel={() => setConfirmDate(null)}
                onDelete={() => del(p.date)}
                canInclude={!!profile}
                includeConfirming={confirmIncludeDate === p.date}
                onAskInclude={() => askInclude(p)}
                onInclude={() => takeOverFoods(p.plan)}
                onCancelInclude={() => setConfirmIncludeDate(null)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const r0 = (n: number) => Math.round(n).toLocaleString('ko-KR');

function DayPlanCard({
  item,
  confirming,
  onAskDelete,
  onCancel,
  onDelete,
  canInclude,
  includeConfirming,
  onAskInclude,
  onInclude,
  onCancelInclude,
}: {
  item: SavedDayPlan;
  confirming: boolean;
  onAskDelete: () => void;
  onCancel: () => void;
  onDelete: () => void;
  canInclude: boolean;
  includeConfirming: boolean;
  onAskInclude: () => void;
  onInclude: () => void;
  onCancelInclude: () => void;
}) {
  const { plan } = item;
  return (
    <article
      aria-label={`날짜별 식단: ${item.date}`}
      className="rounded-2xl border border-neutral-300 p-4 dark:border-neutral-600"
    >
      <header className="mb-2">
        <p className="font-semibold">{dateLabel(item.date)}</p>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {T.total} {r0(plan.totals.kcal)}kcal · 단백질{' '}
          {r0(plan.totals.protein)}g · 식이섬유 {r0(plan.totals.fiber)}g
        </p>
      </header>
      <div className="space-y-3">
        {plan.meals.map((m) => (
          <section key={m.mealType} aria-label={MEAL_LABELS[m.mealType]}>
            <h3 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
              {MEAL_LABELS[m.mealType]} · {r0(m.totals.kcal)}kcal
            </h3>
            <ul className="space-y-0.5 text-sm">
              {m.items.map((i) => (
                <li key={i.foodId} className="flex justify-between gap-2">
                  <span className="font-medium">{i.name}</span>
                  <span>
                    {i.grams}g
                    <span className="ml-1 text-xs text-neutral-500">
                      ({BASIS_SHORT[i.basis]})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {m.oils.length > 0 && (
              <p className="mt-1 text-sm">
                {T.oils}:{' '}
                {m.oils.map((o) => `${o.name} ${o.grams}g`).join(', ')}
              </p>
            )}
            {m.seasonings.length > 0 && (
              <p className="mt-1 text-sm">
                {T.seasonings}:{' '}
                {m.seasonings
                  .map(
                    (s) =>
                      `${s.name} ${Number(s.units.toFixed(1))}${s.unitLabel}`,
                  )
                  .join(', ')}
              </p>
            )}
          </section>
        ))}
      </div>
      <div className="mt-3 space-y-1">
        {includeConfirming ? (
          <div role="group" aria-label={T.includeConfirm} className="space-y-2">
            <p className="text-sm font-medium">{T.includeConfirm}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onInclude}
                className={`${buttonClass} bg-emerald-600 text-white`}
              >
                {T.includeConfirmYes}
              </button>
              <button
                type="button"
                onClick={onCancelInclude}
                className={`${buttonClass} border border-neutral-300 dark:border-neutral-600`}
              >
                {T.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAskInclude}
            disabled={!canInclude}
            aria-label={`${item.date} ${T.includeButton}`}
            className={`${buttonClass} border border-emerald-600 text-sm text-emerald-800 disabled:opacity-40 dark:text-emerald-300`}
          >
            {T.includeButton}
          </button>
        )}
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          {canInclude ? T.includeNote : T.needProfile}
        </p>
      </div>
      <div className="mt-3">
        {confirming ? (
          <div role="group" aria-label={T.confirmDelete} className="space-y-2">
            <p className="text-sm font-medium">{T.confirmDelete}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onDelete}
                className={`${buttonClass} bg-red-700 text-white`}
              >
                {T.confirmYes}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className={`${buttonClass} border border-neutral-300 dark:border-neutral-600`}
              >
                {T.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAskDelete}
            aria-label={`${item.date} 식단 ${T.delete}`}
            className={`${buttonClass} border border-neutral-300 text-sm dark:border-neutral-600`}
          >
            {T.delete}
          </button>
        )}
      </div>
    </article>
  );
}
