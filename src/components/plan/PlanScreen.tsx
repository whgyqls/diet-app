'use client';

import Link from 'next/link';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { FOODS } from '@/lib/data/load';
import { isFoodExcludedByStyles } from '@/lib/nutrition/styleExclusion';
import {
  initialPlanState,
  planReducer,
  rerollRequestOf,
} from '@/lib/plan/planState';
import { comboSignature, isSaved } from '@/lib/plan/savedCombos';
import { newStarSnapshot } from '@/lib/plan/starSnapshot';
import { parseProfile } from '@/lib/profile';
import {
  requestFingerprint,
  type PlanInputs,
} from '@/lib/plan/requestFingerprint';
import { usePlanWorker } from '@/lib/plan/usePlanWorker';
import { useSavedCombos } from '@/lib/plan/useSavedCombos';
import { effectiveIncludes } from '@/lib/nutrition/includeFoods';
import { selectionProblems } from '@/lib/selection/selection';
import { useAppStore } from '@/lib/store/appStore';
import { useHydrated } from '@/lib/store/useHydrated';
import { DISCLAIMER, MEAL_LABELS, NOTICE_TEXT } from '@/lib/ui-labels';
import type { SwapSlot } from '@/lib/nutrition/swap';
import { COMPARE_MAX } from '@/lib/nutrition/constants';
import type { MealType } from '@/types/nutrition';
import { CompareSheet } from './CompareSheet';
import { ComboCard } from './ComboCard';
import { ComboCarousel } from './ComboCarousel';
import { DaySummaryBars } from './DaySummaryBars';
import { FlagList } from './FlagList';
import { IncludeFoodsPanel } from './IncludeFoodsPanel';
import { IncludeFoodsSheet } from './IncludeFoodsSheet';
import { RepeatNotice } from './RepeatNotice';
import { SwapSheet } from './SwapSheet';

type Combo = Parameters<typeof comboSignature>[0];

/** Snapshot for the star, with a uuid id. A module-level function (not created while rendering): it reads the clock. */
function snapshotFor(combo: Combo, mealType: MealType, fingerprint: string) {
  return newStarSnapshot(combo, mealType, fingerprint, Date.now());
}

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
  const includes = useMemo(
    () =>
      effectiveIncludes(s.includeFoods, s.selection, FOODS, (f) =>
        isFoodExcludedByStyles(f, s.styles, profile?.goal ?? 'maintain'),
      ),
    [s.includeFoods, s.selection, s.styles, profile],
  );
  const inputs: PlanInputs | null = useMemo(
    () =>
      profile && problems.length === 0
        ? {
            profile,
            styles: s.styles,
            overrides: s.overrides,
            selection: s.selection,
            includeFoods: includes.kept,
          }
        : null,
    [profile, problems, s.styles, s.overrides, s.selection, includes.kept],
  );
  // Foods that can no longer be asked for are removed from the store; the reason stays on screen until closed.
  const { setIncludeFoods, dropIncludes, clearIncludeDropped } = s;
  useEffect(() => {
    if (includes.dropped.length > 0)
      dropIncludes(includes.kept, includes.dropped);
  }, [includes, dropIncludes]);
  const [includeOpen, setIncludeOpen] = useState(false);
  const fingerprint = useMemo(
    () => (inputs ? requestFingerprint(inputs) : null),
    [inputs],
  );

  const [state, dispatch] = useReducer(planReducer, initialPlanState);
  const [tab, setTab] = useState<MealType | null>(null);
  const requestedFp = useRef<string | null>(null);

  const { status, error, pendingMeals, runDay, runMeal } = usePlanWorker({
    onDay: (res) =>
      dispatch({
        type: 'loaded',
        plan: res.plan,
        base: res.base,
        fingerprint: requestedFp.current ?? '',
      }),
    onMeal: (meal, result) =>
      dispatch(
        result.combos.length > 0
          ? { type: 'rerolled', meal, combos: result.combos }
          : { type: 'rerollFailed', meal, reason: result.reason },
      ),
    onMealError: (meal) =>
      dispatch({ type: 'rerollFailed', meal, error: true }),
  });
  const { list: saved, toggle: toggleStar } = useSavedCombos();
  const [swap, setSwap] = useState<{
    meal: MealType;
    cardId: string;
    slot: SwapSlot;
  } | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

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
  const lockedIds = [
    current.locks.protein,
    current.locks.carb,
    current.locks.fat,
    ...current.locks.fibers,
  ].filter((x): x is string => x !== undefined);
  const rerolling = pendingMeals.includes(current.mealType);
  const reroll = () => {
    const req = rerollRequestOf(state, current.mealType);
    runMeal({
      meal: current.mealType,
      targets: current.targets,
      selection: s.selection,
      locked: req.locked,
      seen: req.seen,
      count: req.count,
      otherPicked: req.otherPicked,
    });
  };
  // The store rolls the star back when saving fails; the "저장하지 못했어요" notice is added with the server store (5d).
  const toggleSave = (combo: Combo) =>
    void toggleStar(
      snapshotFor(combo, current.mealType, state.fingerprint),
    ).catch(() => {});
  const swapMeal = swap
    ? state.meals.find((m) => m.mealType === swap.meal)
    : undefined;
  const swapCard = swapMeal?.cards.find((c) => c.id === swap?.cardId);
  const liveCardIds = state.meals.flatMap((m) => m.cards.map((c) => c.id));
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
          <IncludeFoodsPanel
            ids={includes.kept}
            missing={state.day.missingIncludes}
            dropped={s.includeDropped}
            onOpen={() => setIncludeOpen(true)}
            onRemove={(id) =>
              setIncludeFoods(includes.kept.filter((x) => x !== id))
            }
            onDismissDropped={clearIncludeDropped}
          />
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
            <RepeatNotice cards={current.cards} />
            {state.notice && (
              <div
                role="status"
                data-testid="plan-notice"
                className="mx-4 mb-3 flex items-center justify-between gap-2 rounded-lg border border-neutral-300 p-3 text-sm dark:border-neutral-600"
              >
                <span>{NOTICE_TEXT[state.notice.code]}</span>
                <button
                  type="button"
                  aria-label="안내 닫기"
                  onClick={() => dispatch({ type: 'dismissNotice' })}
                  className="min-h-11 min-w-11 rounded-lg"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="mx-4 mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={reroll}
                disabled={rerolling}
                aria-busy={rerolling}
                className="min-h-11 rounded-lg border border-emerald-600 px-4 font-semibold text-emerald-800 disabled:opacity-50 dark:text-emerald-300"
              >
                {rerolling ? '계산 중…' : '다시 추천'}
              </button>
              <span className="text-xs text-neutral-600 dark:text-neutral-400">
                {lockedIds.length > 0
                  ? `🔒 ${lockedIds.length}개는 그대로 두고 나머지만 다시 추천해요`
                  : '🔒로 재료를 고정하면 나머지만 다시 추천해요'}
              </span>
            </div>
            {state.compare.length > 0 && (
              <div className="mx-4 mb-3 flex items-center gap-2 text-sm">
                <span>
                  비교 {state.compare.length}/{COMPARE_MAX}
                </span>
                <button
                  type="button"
                  disabled={state.compare.length < 2}
                  onClick={() => setCompareOpen(true)}
                  className="min-h-11 rounded-lg bg-emerald-600 px-4 font-semibold text-white disabled:opacity-40"
                >
                  비교하기
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'clearCompare' })}
                  className="min-h-11 rounded-lg border border-neutral-300 px-3 dark:border-neutral-600"
                >
                  비우기
                </button>
              </div>
            )}
            {current.cards.length === 0 ? (
              <p className="px-4 text-sm">
                이 끼니는 고른 재료로 만들 수 있는 조합이 없어요.
              </p>
            ) : (
              <ComboCarousel
                cards={current.cards}
                renderCard={(card, i, total) => (
                  <ComboCard
                    combo={card.combo}
                    goal={profile.goal}
                    index={i}
                    total={total}
                    picked={card.id === current.picked?.cardId}
                    onPick={() =>
                      dispatch({
                        type: 'pick',
                        meal: current.mealType,
                        cardId: card.id,
                      })
                    }
                    lockedIds={lockedIds}
                    onToggleLock={(slot, foodId) =>
                      dispatch({
                        type: 'toggleLock',
                        meal: current.mealType,
                        slot,
                        foodId,
                      })
                    }
                    onSwap={(category, foodId) =>
                      setSwap({
                        meal: current.mealType,
                        cardId: card.id,
                        slot: { category, foodId },
                      })
                    }
                    compared={state.compare.some((c) => c.cardId === card.id)}
                    onToggleCompare={() =>
                      dispatch({
                        type: 'toggleCompare',
                        meal: current.mealType,
                        cardId: card.id,
                      })
                    }
                    saved={isSaved(saved, comboSignature(card.combo))}
                    onToggleSave={() => toggleSave(card.combo)}
                  />
                )}
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
        <br />
        <Link
          href="/saved"
          className="inline-flex min-h-11 items-center underline"
        >
          저장한 조합 보기
        </Link>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          {DISCLAIMER}
        </p>
      </div>
      {includeOpen && (
        <IncludeFoodsSheet
          initial={includes.kept}
          selection={s.selection}
          mealsPerDay={profile.mealsPerDay}
          isExcluded={(f) => isFoodExcludedByStyles(f, s.styles, profile.goal)}
          onApply={(ids) => {
            setIncludeFoods(ids);
            setIncludeOpen(false);
          }}
          onClose={() => setIncludeOpen(false)}
        />
      )}
      {swap && swapMeal && swapCard && (
        <SwapSheet
          combo={swapCard.combo}
          slot={swap.slot}
          targets={swapMeal.targets}
          selection={s.selection}
          otherPicked={rerollRequestOf(state, swap.meal).otherPicked}
          otherKeys={swapMeal.cards
            .filter((c) => c.id !== swapCard.id)
            .map((c) => c.combo.key)}
          onSelect={(combo) => {
            dispatch({
              type: 'swapped',
              meal: swap.meal,
              cardId: swap.cardId,
              combo,
            });
            setSwap(null);
          }}
          onClose={() => setSwap(null)}
        />
      )}
      {compareOpen && state.compare.length >= 1 && (
        <CompareSheet
          entries={state.compare}
          liveCardIds={liveCardIds}
          onRemove={(cardId) => dispatch({ type: 'removeCompare', cardId })}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  );
}
