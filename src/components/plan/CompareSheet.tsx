'use client';

import { useEffect } from 'react';
import type { CompareEntry } from '@/lib/plan/planState';
import { BASIS_SHORT, MEAL_LABELS } from '@/lib/ui-labels';

const r0 = (n: number) => Math.round(n);

/** 2-3 combos side by side. Entries are snapshots, so they stay even if the card left the list. */
export function CompareSheet({
  entries,
  liveCardIds,
  onRemove,
  onClose,
}: {
  entries: CompareEntry[];
  /** Card ids still in the lists; others are labelled as gone. */
  liveCardIds: string[];
  onRemove: (cardId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows: { label: string; value: (e: CompareEntry) => string }[] = [
    { label: '칼로리', value: (e) => `${r0(e.combo.totals.kcal)}kcal` },
    { label: '단백질', value: (e) => `${r0(e.combo.totals.protein)}g` },
    { label: '총탄수', value: (e) => `${r0(e.combo.totals.carbs)}g` },
    { label: '지방', value: (e) => `${r0(e.combo.totals.fat)}g` },
    { label: '식이섬유', value: (e) => `${r0(e.combo.totals.fiber)}g` },
    { label: '나트륨', value: (e) => `${r0(e.combo.totals.sodium)}mg` },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="조합 비교"
        className="mx-auto max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">조합 비교</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-lg"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-16 p-1 text-left align-bottom text-xs font-normal" />
                {entries.map((e) => (
                  <th key={e.cardId} className="p-1 text-left align-top">
                    <span className="block">{MEAL_LABELS[e.meal]}</span>
                    {!liveCardIds.includes(e.cardId) && (
                      <span className="block text-xs font-normal">
                        목록에서 빠진 조합
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemove(e.cardId)}
                      className="mt-1 min-h-11 rounded-lg border border-neutral-300 px-2 text-xs font-normal dark:border-neutral-600"
                    >
                      빼기
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-neutral-200 align-top dark:border-neutral-700">
                <th scope="row" className="p-1 text-left text-xs font-normal">
                  재료
                </th>
                {entries.map((e) => (
                  <td key={e.cardId} className="p-1">
                    {e.combo.items.map((i) => (
                      <p key={i.food.id}>
                        {i.food.name} {i.grams}g
                        <span className="text-xs text-neutral-500">
                          ({BASIS_SHORT[i.food.basis]})
                        </span>
                      </p>
                    ))}
                  </td>
                ))}
              </tr>
              {rows.map((row) => (
                <tr
                  key={row.label}
                  className="border-t border-neutral-200 dark:border-neutral-700"
                >
                  <th scope="row" className="p-1 text-left text-xs font-normal">
                    {row.label}
                  </th>
                  {entries.map((e) => (
                    <td key={e.cardId} className="p-1">
                      {row.value(e)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
