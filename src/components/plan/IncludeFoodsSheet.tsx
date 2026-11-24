'use client';

import { useEffect, useState } from 'react';
import { FOODS } from '@/lib/data/load';
import {
  canAddInclude,
  includeCapacity,
  isIncludable,
} from '@/lib/nutrition/includeFoods';
import {
  BASIS_SHORT,
  EXCLUDED_BY_STYLE_TEXT,
  INCLUDE_CATEGORY_LABELS,
  INCLUDE_TEXT,
  includeFullText,
} from '@/lib/ui-labels';
import type { Food, FoodCategory } from '@/types/food';
import type { Selection } from '@/types/nutrition';

const ORDER: FoodCategory[] = ['protein', 'carb', 'fiber', 'fat'];

/** Pick the foods the day must contain, from the foods the user selected. Applied only with the apply button. */
export function IncludeFoodsSheet({
  initial,
  selection,
  mealsPerDay,
  isExcluded,
  onApply,
  onClose,
}: {
  initial: string[];
  selection: Selection;
  mealsPerDay: number;
  isExcluded: (f: Food) => boolean;
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(initial);
  const [full, setFull] = useState<FoodCategory | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const usable = FOODS.filter((f) => selection.foods[f.id] && isIncludable(f));
  const cap = includeCapacity(mealsPerDay);
  const toggle = (f: Food) => {
    if (draft.includes(f.id)) {
      setDraft(draft.filter((x) => x !== f.id));
      setFull(null);
    } else if (canAddInclude(draft, f, FOODS, mealsPerDay)) {
      setDraft([...draft, f.id]);
      setFull(null);
    } else setFull(f.category);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={INCLUDE_TEXT.title}
        className="mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold">{INCLUDE_TEXT.title}</h2>
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
          {INCLUDE_TEXT.sheetNote}
        </p>
        {usable.length === 0 && (
          <p className="text-sm">{INCLUDE_TEXT.noSelected}</p>
        )}
        {full && (
          <p
            role="status"
            data-testid="include-full"
            className="mb-3 rounded-lg border border-neutral-300 p-3 text-sm dark:border-neutral-600"
          >
            {includeFullText(full, cap[full])}
          </p>
        )}
        {ORDER.map((cat) => {
          const list = usable.filter((f) => f.category === cat);
          if (list.length === 0) return null;
          return (
            <fieldset key={cat} className="mb-3">
              <legend className="mb-1 text-sm font-semibold">
                {INCLUDE_CATEGORY_LABELS[cat]}
              </legend>
              <ul className="space-y-2">
                {list.map((f) => {
                  const excluded = isExcluded(f);
                  return (
                    <li key={f.id}>
                      <label
                        className={`flex min-h-12 items-center gap-3 rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-600 ${excluded ? 'opacity-50' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={draft.includes(f.id)}
                          disabled={excluded}
                          onChange={() => toggle(f)}
                          className="h-5 w-5"
                        />
                        <span className="flex flex-col">
                          <span className="font-medium">
                            {f.name}{' '}
                            <span className="text-xs font-normal text-neutral-600 dark:text-neutral-400">
                              {BASIS_SHORT[f.basis]}
                            </span>
                          </span>
                          {excluded && (
                            <span className="text-xs">
                              {EXCLUDED_BY_STYLE_TEXT}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
        <button
          type="button"
          onClick={() => onApply(draft)}
          className="min-h-11 w-full rounded-lg bg-emerald-600 font-semibold text-white"
        >
          {INCLUDE_TEXT.apply}
        </button>
      </div>
    </div>
  );
}
