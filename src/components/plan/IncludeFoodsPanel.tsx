'use client';

import { FOODS } from '@/lib/data/load';
import {
  INCLUDE_TEXT,
  includeDroppedText,
  includeMissingText,
} from '@/lib/ui-labels';
import type { DropReason } from '@/lib/nutrition/includeFoods';

const nameOf = (id: string) => FOODS.find((f) => f.id === id)?.name ?? id;

/** The "must include" foods as chips, which of them the plan could not fit, and what was dropped. */
export function IncludeFoodsPanel({
  ids,
  missing,
  dropped,
  onOpen,
  onRemove,
  onDismissDropped,
}: {
  ids: string[];
  missing: string[];
  dropped: { id: string; reason: DropReason }[];
  onOpen: () => void;
  onRemove: (id: string) => void;
  onDismissDropped: () => void;
}) {
  return (
    <section aria-label={INCLUDE_TEXT.title} className="space-y-2 px-4 pt-4">
      <h2 className="text-sm font-semibold">{INCLUDE_TEXT.title}</h2>
      {ids.length === 0 ? (
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {INCLUDE_TEXT.empty}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <li
              key={id}
              className="flex items-center gap-1 rounded-full border border-emerald-600 pl-3 text-sm"
            >
              <span>{nameOf(id)}</span>
              {missing.includes(id) && (
                <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-900">
                  {INCLUDE_TEXT.missingTag}
                </span>
              )}
              <button
                type="button"
                aria-label={`${nameOf(id)} 빼기`}
                onClick={() => onRemove(id)}
                className="min-h-11 min-w-11 rounded-full"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="min-h-11 rounded-lg border border-emerald-600 px-4 text-sm font-semibold text-emerald-800 dark:text-emerald-300"
      >
        {ids.length === 0 ? INCLUDE_TEXT.open : INCLUDE_TEXT.change}
      </button>
      {missing.length > 0 && (
        <p
          role="alert"
          data-testid="include-missing"
          className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {includeMissingText(missing.map(nameOf))}
        </p>
      )}
      {dropped.length > 0 && (
        <p
          role="status"
          data-testid="include-dropped"
          className="flex items-center justify-between gap-2 rounded-lg border border-neutral-300 p-3 text-sm dark:border-neutral-600"
        >
          <span>
            {includeDroppedText(
              dropped.map((d) => ({ name: nameOf(d.id), reason: d.reason })),
            )}
          </span>
          <button
            type="button"
            aria-label="안내 닫기"
            onClick={onDismissDropped}
            className="min-h-11 min-w-11 rounded-lg"
          >
            ✕
          </button>
        </p>
      )}
    </section>
  );
}
