'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAccountGate, useAccountSnapshot } from '@/lib/account/useAccount';
import {
  DAY_PLAN_MAX_DATE,
  DAY_PLAN_MIN_DATE,
  dayPlanOf,
  isValidDateText,
  localDateText,
} from '@/lib/plan/dayPlans';
import type { MealState } from '@/lib/plan/planState';
import { createClient } from '@/lib/supabase/client';
import { saveDayPlan } from '@/lib/supabase/dayPlansRemote';
import { DAY_PLAN_TEXT as T } from '@/lib/ui-labels';
import type { DayPlan } from '@/types/nutrition';

type Status = 'idle' | 'saving' | 'saved' | 'error';

/** Saves the picked combos of every meal as the day plan of a chosen date (today at first). */
export function SaveDayPlan({
  meals,
  day,
}: {
  meals: readonly MealState[];
  day: DayPlan;
}) {
  const { uid } = useAccountSnapshot();
  const gate = useAccountGate();
  const [date, setDate] = useState(() => localDateText(new Date()));
  const [status, setStatus] = useState<Status>('idle');
  const [savedDate, setSavedDate] = useState('');

  const data = dayPlanOf(meals, day.totals);
  const validDate = isValidDateText(date);
  const canSave =
    !!uid && gate === 'ready' && !!data && validDate && status !== 'saving';

  const save = async () => {
    if (!canSave || !uid || !data) return;
    setStatus('saving');
    try {
      await saveDayPlan(createClient(), uid, date, data);
      setSavedDate(date);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  if (!data) return null;
  return (
    <section aria-label={T.saveTitle} className="space-y-2 px-4 pt-4">
      <h2 className="text-sm font-semibold">{T.saveTitle}</h2>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        {T.saveHint}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="day-plan-date" className="text-sm">
          {T.dateLabel}
        </label>
        <input
          id="day-plan-date"
          type="date"
          value={date}
          min={DAY_PLAN_MIN_DATE}
          max={DAY_PLAN_MAX_DATE}
          onChange={(e) => {
            setDate(e.target.value);
            setStatus('idle');
          }}
          className="min-h-11 rounded-lg border border-neutral-300 bg-transparent px-2 dark:border-neutral-600"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          aria-busy={status === 'saving'}
          className="min-h-11 rounded-lg bg-emerald-600 px-4 font-semibold text-white disabled:opacity-40"
        >
          {status === 'saving' ? T.saving : T.save}
        </button>
      </div>
      {!validDate && (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
          {T.badDate}
        </p>
      )}
      {status === 'saved' && (
        <p role="status" className="text-sm">
          {T.saved(savedDate)}{' '}
          <Link href="/saved" className="underline">
            {T.seeSaved}
          </Link>
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
          {T.saveFailed}
        </p>
      )}
    </section>
  );
}
