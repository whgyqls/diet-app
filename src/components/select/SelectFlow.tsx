'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FOODS, SEASONINGS } from '@/lib/data/load';
import { isFoodExcludedByStyles } from '@/lib/nutrition/styleExclusion';
import { countSelected, selectionProblems } from '@/lib/selection/selection';
import { useAppStore } from '@/lib/store/appStore';
import { useHydrated } from '@/lib/store/useHydrated';
import { parseProfile } from '@/lib/profile';
import { STEPS } from '@/lib/ui-labels';
import type { Food } from '@/types/food';
import { FactsSheet } from './FactsSheet';
import { FoodCard } from './FoodCard';

const PROBLEM_TEXT = {
  NEED_PROTEIN: '단백질 재료를 1개 이상 골라 주세요',
  NEED_FIBER: '식이섬유 재료를 1개 이상 골라 주세요',
} as const;

export function SelectFlow() {
  const hydrated = useHydrated();
  if (!hydrated) return <p className="p-4">불러오는 중…</p>;
  return <Flow />;
}

function Flow() {
  const s = useAppStore();
  const [filter, setFilter] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Food | null>(null);
  const step = Math.min(Math.max(s.step, 0), STEPS.length - 1);
  const cur = STEPS[step];
  const goal = parseProfile(s.profile)?.goal ?? s.profile.goal ?? 'maintain';
  const isExcluded = (f: Food) => isFoodExcludedByStyles(f, s.styles, goal);

  const problems = useMemo(
    () =>
      selectionProblems(s.selection, FOODS, (f) =>
        isFoodExcludedByStyles(f, s.styles, goal),
      ),
    [s.selection, s.styles, goal],
  );

  const foods = FOODS.filter((f) => f.category === cur.key);
  const groups = [...new Set(foods.map((f) => f.group))];
  const shown = filter ? foods.filter((f) => f.group === filter) : foods;
  const isSeasoning = cur.key === 'seasoning';

  const go = (n: number) => {
    s.setStep(n);
    setFilter(null);
    window.scrollTo({ top: 0 });
  };
  const countOf = (i: number) => {
    const k = STEPS[i].key;
    return k === 'seasoning'
      ? countSelected(
          s.selection,
          'seasonings',
          SEASONINGS.map((x) => x.id),
        )
      : FOODS.filter(
          (f) => f.category === k && s.selection.foods[f.id] && !isExcluded(f),
        ).length;
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4 pb-32">
      <h1 className="text-xl font-bold">재료 고르기</h1>
      {!parseProfile(s.profile) && (
        <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
          프로필이 아직 없어요.{' '}
          <Link href="/onboarding" className="font-semibold underline">
            먼저 프로필을 입력
          </Link>
          해 주세요.
        </p>
      )}

      <nav aria-label="진행 단계">
        <ol className="flex gap-1">
          {STEPS.map((st, i) => (
            <li key={st.key} className="flex-1">
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === step ? 'step' : undefined}
                className={`min-h-11 w-full rounded-lg px-1 text-xs font-medium ${
                  i === step
                    ? 'bg-emerald-600 text-white'
                    : 'border border-neutral-300 dark:border-neutral-600'
                }`}
              >
                <span className="block">
                  {i + 1}. {st.label}
                </span>
                <span className="block opacity-80">{countOf(i)}개</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {problems.length > 0 ? (
        <p
          role="status"
          className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900"
        >
          {problems.map((p) => PROBLEM_TEXT[p]).join(' · ')}.
          탄수화물·지방원·양념은 0개여도 괜찮아요.
        </p>
      ) : (
        <p
          role="status"
          className="rounded-lg bg-emerald-100 p-3 text-sm text-emerald-900"
        >
          최소 조건을 채웠어요. 탄수화물·지방원·양념은 0개여도 괜찮아요.
        </p>
      )}

      {!isSeasoning && groups.length > 1 && (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="분류 필터"
        >
          {[null, ...groups].map((g) => (
            <button
              key={g ?? 'all'}
              type="button"
              aria-pressed={filter === g}
              onClick={() => setFilter(g)}
              className={`min-h-11 rounded-full border px-4 text-sm ${
                filter === g
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-neutral-300 dark:border-neutral-600'
              }`}
            >
              {g ?? '전체'}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="min-h-11 flex-1 rounded-lg border border-neutral-300 text-sm dark:border-neutral-600"
          onClick={() =>
            isSeasoning
              ? s.selectAllSeasonings(SEASONINGS.map((x) => x.id))
              : s.selectAllFoods(shown.map((f) => f.id))
          }
        >
          전체 선택
        </button>
        <button
          type="button"
          className="min-h-11 flex-1 rounded-lg border border-neutral-300 text-sm dark:border-neutral-600"
          onClick={() =>
            isSeasoning
              ? s.clearAllSeasonings(SEASONINGS.map((x) => x.id))
              : s.clearAllFoods(shown.map((f) => f.id))
          }
        >
          전체 해제
        </button>
      </div>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        눌러서 &quot;먹을 수 있음 ✓&quot; → &quot;좋아함 ♥&quot; → 해제. 고르지
        않은 재료는 추천에서 빠져요.
      </p>

      <ul className="flex flex-col gap-2">
        {isSeasoning
          ? SEASONINGS.map((x) => {
              const st = s.selection.seasonings[x.id];
              return (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => s.toggleSeasoning(x.id)}
                    aria-label={`${x.name}, ${st === 'favorite' ? '좋아함' : st ? '먹을 수 있음' : '선택 안 함'}`}
                    className={`flex min-h-14 w-full items-center gap-2 rounded-xl border p-3 text-left ${
                      st
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950'
                        : 'border-neutral-300 dark:border-neutral-700'
                    }`}
                  >
                    <span aria-hidden className="w-5 text-emerald-700">
                      {st === 'favorite' ? '♥' : st ? '✓' : '○'}
                    </span>
                    <span className="flex-1">
                      <span className="block font-semibold">{x.name}</span>
                      <span className="block text-xs text-neutral-700 dark:text-neutral-300">
                        {x.unit.label} 기준 · 나트륨 {x.perUnit.sodium}mg
                        {x.free ? ' · 자유롭게' : ''}
                        {x.oil ? ' · 기름' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          : shown.map((f) => (
              <FoodCard
                key={f.id}
                food={f}
                status={s.selection.foods[f.id]}
                excluded={isExcluded(f)}
                onToggle={() => s.toggleFood(f.id)}
                onInfo={() => setSheet(f)}
              />
            ))}
      </ul>

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-neutral-800">
        <div className="mx-auto flex max-w-md gap-2">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => go(step - 1)}
            className="min-h-12 flex-1 rounded-lg border border-neutral-300 font-medium disabled:opacity-40 dark:border-neutral-600"
          >
            이전
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => go(step + 1)}
              className="min-h-12 flex-[2] rounded-lg bg-emerald-600 font-semibold text-white"
            >
              다음
            </button>
          ) : (
            <Link
              href="/plan"
              aria-disabled={problems.length > 0}
              onClick={(e) => problems.length > 0 && e.preventDefault()}
              className={`flex min-h-12 flex-[2] items-center justify-center rounded-lg bg-emerald-600 font-semibold text-white ${problems.length > 0 ? 'opacity-40' : ''}`}
            >
              완료
            </Link>
          )}
        </div>
      </div>

      {sheet && <FactsSheet food={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
