'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { FOODS } from '@/lib/data/load';
import { isFoodExcludedByStyles } from '@/lib/nutrition/styleExclusion';
import { initialPlanState, planReducer } from '@/lib/plan/planState';
import { parseProfile } from '@/lib/profile';
import {
  requestFingerprint,
  type PlanInputs,
} from '@/lib/plan/requestFingerprint';
import { usePlanWorker } from '@/lib/plan/usePlanWorker';
import { selectionProblems } from '@/lib/selection/selection';
import { useAppStore } from '@/lib/store/appStore';
import { useHydrated } from '@/lib/store/useHydrated';
import { DISCLAIMER, MEAL_LABELS } from '@/lib/ui-labels';
import type { MealType } from '@/types/nutrition';
import { ComboCarousel } from './ComboCarousel';
import { DaySummaryBars } from './DaySummaryBars';
import { FlagList } from './FlagList';

const linkClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-600 px-4 font-semibold text-white';

export function PlanScreen() {
  const hydrated = useHydrated();
  if (!hydrated)
    return (
      <p role="status" className="p-4">
        불러오는 중…
      </p>
    );
  return <Plan />;
}

function Guide({
  text,
  href,
  label,
}: {
  text: string;
  href: string;
  label: string;
}) {
  return (
    <div className="space-y-3 p-4">
      <p>{text}</p>
      <Link href={href} className={linkClass}>
        {label}
      </Link>
    </div>
  );
}

function Plan() {
  const s = useAppStore();
  const profile = useMemo(() => parseProfile(s.profile), [s.profile]);
  const problems = useMemo(
    () =>
      selectionProblems(s.selection, FOODS, (f) =>
        isFoodExcludedByStyles(f, s.styles, profile?.goal ?? 'maintain'),
      ),
    [s.selection, s.styles, profile],
  );
  const inputs: PlanInputs | null = useMemo(
    () =>
      profile && problems.length === 0
        ? {
            profile,
            styles: s.styles,
            overrides: s.overrides,
            selection: s.selection,
          }
        : null,
    [profile, problems, s.styles, s.overrides, s.selection],
  );
  const fingerprint = useMemo(
    () => (inputs ? requestFingerprint(inputs) : null),
    [inputs],
  );

  const [state, dispatch] = useReducer(planReducer, initialPlanState);
  const [tab, setTab] = useState<MealType | null>(null);
  const requestedFp = useRef<string | null>(null);

  const { status, error, runDay } = usePlanWorker(
    useCallback((res) => {
      dispatch({
        type: 'loaded',
        plan: res.plan,
        base: res.base,
        fingerprint: requestedFp.current ?? '',
      });
    }, []),
  );

  useEffect(() => {
    if (!inputs || !fingerprint || requestedFp.current === fingerprint) return;
    requestedFp.current = fingerprint;
    dispatch({ type: 'fingerprint', fingerprint });
    runDay(inputs);
  }, [inputs, fingerprint, runDay]);
  // Forget the last request on unmount so a StrictMode remount (or coming back) calculates again.
  useEffect(
    () => () => {
      requestedFp.current = null;
    },
    [],
  );

  if (!profile)
    return (
      <Guide
        text="먼저 프로필을 입력해 주세요. 목표 칼로리와 영양 목표를 계산하는 데 필요해요."
        href="/onboarding"
        label="프로필 입력하러 가기"
      />
    );
  if (problems.length > 0)
    return (
      <Guide
        text={`${problems
          .map((p) => (p === 'NEED_PROTEIN' ? '단백질' : '식이섬유'))
          .join('·')} 재료를 1개 이상 골라 주세요.`}
        href="/select"
        label="재료 고르러 가기"
      />
    );
  if (status === 'error')
    return (
      <div className="space-y-3 p-4">
        <p role="alert">{error}</p>
        <button
          type="button"
          className={linkClass}
          onClick={() => {
            if (inputs) runDay(inputs);
          }}
        >
          다시 시도
        </button>
      </div>
    );
  if (!state || state.fingerprint !== fingerprint)
    return (
      <div role="status" className="space-y-3 p-4">
        <p className="font-medium">추천 조합을 계산하고 있어요…</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          재료를 많이 골랐다면 몇 초 걸릴 수 있어요.
        </p>
        <div className="h-24 animate-pulse rounded-2xl bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-48 animate-pulse rounded-2xl bg-neutral-200 dark:bg-neutral-800" />
      </div>
    );

  const noCombos = state.meals.every((m) => m.cards.length === 0);
  const current = state.meals.find((m) => m.mealType === tab) ?? state.meals[0];
  return (
    <div className="pb-8">
      <h1 className="px-4 pt-4 text-xl font-bold">추천 식단</h1>
      {noCombos ? (
        <Guide
          text="고른 재료로는 조합을 만들 수 없어요. 재료를 더 골라 주세요."
          href="/select"
          label="재료 다시 고르기"
        />
      ) : (
        <>
          <DaySummaryBars plan={state.day} />
          <FlagList plan={state.day} />
          <div
            role="tablist"
            aria-label="끼니"
            className="mt-4 flex gap-2 px-4"
          >
            {state.meals.map((m) => (
              <button
                key={m.mealType}
                type="button"
                role="tab"
                aria-selected={m.mealType === current.mealType}
                onClick={() => setTab(m.mealType)}
                className={`min-h-11 flex-1 rounded-lg border font-semibold ${m.mealType === current.mealType ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-neutral-300 dark:border-neutral-600'}`}
              >
                {MEAL_LABELS[m.mealType]}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            aria-label={MEAL_LABELS[current.mealType]}
            className="mt-3"
          >
            {current.cards.length === 0 ? (
              <p className="px-4 text-sm">
                이 끼니는 고른 재료로 만들 수 있는 조합이 없어요.
              </p>
            ) : (
              <ComboCarousel
                cards={current.cards}
                pickedCardId={current.picked?.cardId}
                onPick={(cardId) =>
                  dispatch({ type: 'pick', meal: current.mealType, cardId })
                }
              />
            )}
          </div>
        </>
      )}
      <div className="mt-6 space-y-3 px-4">
        <Link
          href="/select"
          className="inline-flex min-h-11 items-center underline"
        >
          재료 다시 고르기
        </Link>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          {DISCLAIMER}
        </p>
      </div>
    </div>
  );
}
