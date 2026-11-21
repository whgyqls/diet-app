'use client';

import { useEffect, useMemo } from 'react';
import { FOODS, SEASONINGS } from '@/lib/data/load';
import { swapCandidates, type SwapSlot } from '@/lib/nutrition/swap';
import { BASIS_SHORT } from '@/lib/ui-labels';
import type { MealCombo, MealTargets, Selection } from '@/types/nutrition';

/** Same-category replacements for one food; the engine re-portions the whole combo for each. */
export function SwapSheet({
  combo,
  slot,
  targets,
  selection,
  otherPicked,
  otherKeys,
  onSelect,
  onClose,
}: {
  combo: MealCombo;
  slot: SwapSlot;
  targets: MealTargets;
  selection: Selection;
  otherPicked: MealCombo[];
  /** comboKeys of the other cards of this meal (a swap may not duplicate one). */
  otherKeys: string[];
  onSelect: (combo: MealCombo) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = combo.items.find((i) => i.food.id === slot.foodId)!.food;
  const list = useMemo(
    () =>
      swapCandidates(combo, slot, {
        foods: FOODS,
        seasonings: SEASONINGS,
        selection,
        targets,
        otherPicked,
      }),
    [combo, slot, selection, targets, otherPicked],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${current.name} 바꾸기`}
        className="mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold">{current.name} 바꾸기</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-lg"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">
          같은 분류에서 고른 재료만 보여줘요. 바꾸면 분량이 다시 계산돼요.
        </p>
        {list.length === 0 ? (
          <p className="text-sm">바꿀 수 있는 다른 재료가 없어요.</p>
        ) : (
          <ul className="space-y-2">
            {list.map(({ food, combo: next, overlapsOtherMeal }) => {
              const duplicate = next ? otherKeys.includes(next.key) : false;
              const disabled = !next || duplicate;
              const grams = next?.items.find(
                (i) => i.food.id === food.id,
              )?.grams;
              return (
                <li key={food.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => next && onSelect(next)}
                    className="flex min-h-12 w-full flex-col rounded-lg border border-neutral-300 px-3 py-2 text-left disabled:opacity-50 dark:border-neutral-600"
                  >
                    <span className="flex justify-between gap-2">
                      <span className="font-medium">{food.name}</span>
                      {grams !== undefined && (
                        <span className="text-sm">
                          {grams}g ({BASIS_SHORT[food.basis]})
                        </span>
                      )}
                    </span>
                    {next && (
                      <span className="text-xs text-neutral-600 dark:text-neutral-400">
                        끼니 {Math.round(next.totals.kcal)}kcal · 단백질{' '}
                        {Math.round(next.totals.protein)}g
                      </span>
                    )}
                    {overlapsOtherMeal && (
                      <span className="text-xs text-amber-800 dark:text-amber-300">
                        다른 끼니와 겹쳐요
                      </span>
                    )}
                    {!next && (
                      <span className="text-xs">
                        이 재료로는 분량을 맞출 수 없어요
                      </span>
                    )}
                    {duplicate && (
                      <span className="text-xs">
                        이미 목록에 있는 조합이에요
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
