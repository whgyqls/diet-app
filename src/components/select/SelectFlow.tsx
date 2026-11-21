'use client';

import Link from 'next/link';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { FOODS, SEASONINGS } from '@/lib/data/load';
import { isFoodExcludedByStyles } from '@/lib/nutrition/styleExclusion';
import {
  EMPTY_SELECTION,
  countSelected,
  filterStepFoods,
  selectionProblems,
  stepFilters,
} from '@/lib/selection/selection';
import { useAppStore } from '@/lib/store/appStore';
import { useHydrated } from '@/lib/store/useHydrated';
import { parseProfile } from '@/lib/profile';
import { STEPS } from '@/lib/ui-labels';
import type { Food } from '@/types/food';
import type { DietStyle, Selection } from '@/types/nutrition';
import { ConfirmDialog } from './ConfirmDialog';
import { FactsSheet } from './FactsSheet';
import { FoodCard } from './FoodCard';
import { KitSheet } from './KitSheet';
import { UndoToast } from './UndoToast';

type Undo = {
  id: number;
  message: string;
  selection: Selection;
  styles?: DietStyle[];
};

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
  // Always open on the first step (a saved step would put people back on the last one, 양념).
  // Layout effect: runs before paint, so the old step never flashes.
  useLayoutEffect(() => {
    useAppStore.getState().startSelection();
  }, []);
  const [filter, setFilter] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Food | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [kitsOpen, setKitsOpen] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const closeUndo = useCallback(() => setUndo(null), []);
  const closeKits = useCallback(() => setKitsOpen(false), []);
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

  const isSeasoning = cur.key === 'seasoning';
  const foods = FOODS.filter((f) => f.category === cur.key);
  const filters = isSeasoning
    ? []
    : stepFilters(foods, cur.key as Food['category']);
  const shown = isSeasoning
    ? []
    : filterStepFoods(foods, cur.key as Food['category'], filter);
  const stepIds = isSeasoning
    ? SEASONINGS.map((x) => x.id)
    : foods.map((f) => f.id);
  const stepSelected = countSelected(
    s.selection,
    isSeasoning ? 'seasonings' : 'foods',
    stepIds,
  );
  const totalSelected =
    Object.keys(s.selection.foods).length +
    Object.keys(s.selection.seasonings).length;

  const remember = (message: string, withStyles = false) =>
    // A new id re-keys the toast so its 10 s timer restarts.
    setUndo((prev) => ({
      id: (prev?.id ?? 0) + 1,
      message,
      selection: s.selection,
      ...(withStyles ? { styles: s.styles } : {}),
    }));
  const resetAll = () => {
    remember('고른 재료를 모두 초기화했어요');
    s.replaceSelection(EMPTY_SELECTION);
    setConfirmReset(false);
  };
  const resetStep = () => {
    remember(`${cur.label} 단계를 초기화했어요`);
    if (isSeasoning) s.clearAllSeasonings(stepIds);
    else s.clearAllFoods(stepIds);
  };
  const restore = () => {
    if (!undo) return;
    s.replaceSelection(undo.selection);
    if (undo.styles) s.replaceStyles(undo.styles);
    setUndo(null);
  };

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
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-xl font-bold">재료 고르기</h1>
        <button
          type="button"
          onClick={() => setKitsOpen(true)}
          className="min-h-11 rounded-lg border border-emerald-600 px-3 text-sm font-medium text-emerald-800 dark:text-emerald-300"
        >
          내 재료 세트
        </button>
        <button
          type="button"
          disabled={totalSelected === 0}
          onClick={() => setConfirmReset(true)}
          className="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm disabled:opacity-40 dark:border-neutral-600"
        >
          전체 초기화
        </button>
      </div>
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

      {filters.length > 1 && (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="분류 필터"
        >
          {[{ key: null, label: '전체' }, ...filters].map((g) => (
            <button
              key={g.key ?? 'all'}
              type="button"
              aria-pressed={filter === g.key}
              onClick={() => setFilter(g.key)}
              className={`min-h-11 rounded-full border px-4 text-sm ${
                filter === g.key
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-neutral-300 dark:border-neutral-600'
              }`}
            >
              {g.label}
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
        <button
          type="button"
          disabled={stepSelected === 0}
          className="min-h-11 flex-1 rounded-lg border border-neutral-300 text-sm disabled:opacity-40 dark:border-neutral-600"
          onClick={resetStep}
        >
          이 단계 초기화
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

      {confirmReset && (
        <ConfirmDialog
          title="고른 재료를 모두 지울까요?"
          body="모든 단계의 선택이 해제돼요. 프로필과 식단 스타일은 그대로예요."
          confirmLabel="초기화"
          onCancel={() => setConfirmReset(false)}
          onConfirm={resetAll}
        />
      )}

      {kitsOpen && (
        <KitSheet
          kits={s.kits}
          selectedCount={totalSelected}
          onSave={s.saveKit}
          onRename={s.renameKit}
          onDelete={s.deleteKit}
          onLoad={(id, mode) => {
            const kit = s.kits.find((k) => k.id === id);
            remember(
              `'${kit?.name ?? ''}' 세트를 ${mode === 'replace' ? '불러왔어요' : '합쳤어요'}`,
              true,
            );
            s.loadKit(id, mode);
            setKitsOpen(false);
          }}
          onClose={closeKits}
        />
      )}

      {undo && (
        <UndoToast
          key={undo.id}
          message={undo.message}
          onUndo={restore}
          onClose={closeUndo}
        />
      )}
    </div>
  );
}
