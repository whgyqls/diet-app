'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  groupSavedByMeal,
  savedDateText,
  savedSummary,
} from '@/lib/plan/savedView';
import { useSavedCombos } from '@/lib/plan/useSavedCombos';
import type { SavedCombo } from '@/lib/plan/savedCombos';
import { BASIS_SHORT, MEAL_LABELS } from '@/lib/ui-labels';

const linkClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-600 px-4 font-semibold text-white';

export function SavedList() {
  const { list, status, ready, remove, refresh } = useSavedCombos();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (!ready || status === 'loading')
    return (
      <p role="status" className="p-4">
        불러오는 중…
      </p>
    );
  if (status === 'error')
    return (
      <div className="space-y-3 p-4" role="alert">
        <p className="font-medium">저장한 조합을 불러오지 못했어요</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className={linkClass}
        >
          다시 시도
        </button>
      </div>
    );
  if (list.length === 0)
    return (
      <div className="space-y-3 p-4" data-testid="saved-empty">
        <p className="font-medium">아직 저장한 조합이 없어요</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          추천 화면에서 조합 카드의 ☆를 누르면 여기에 모여요.
        </p>
        <Link href="/plan" className={linkClass}>
          추천 보러 가기
        </Link>
      </div>
    );

  return (
    <div className="space-y-6 p-4 pb-8">
      {groupSavedByMeal(list).map((g) => (
        <section key={g.mealType} aria-label={MEAL_LABELS[g.mealType]}>
          <h2 className="mb-2 text-base font-bold">
            {MEAL_LABELS[g.mealType]}{' '}
            <span className="text-sm font-normal text-neutral-600 dark:text-neutral-400">
              {g.items.length}개
            </span>
          </h2>
          <ul className="space-y-3">
            {g.items.map((s) => (
              <li key={s.id}>
                <SavedCard
                  saved={s}
                  confirming={confirmId === s.id}
                  onAskDelete={() => setConfirmId(s.id)}
                  onCancel={() => setConfirmId(null)}
                  onDelete={() => {
                    // Rolled back by the store when it fails (the notice for that comes with 5d).
                    void remove(s.id).catch(() => {});
                    setConfirmId(null);
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SavedCard({
  saved,
  confirming,
  onAskDelete,
  onCancel,
  onDelete,
}: {
  saved: SavedCombo;
  confirming: boolean;
  onAskDelete: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const sum = savedSummary(saved);
  const names = sum.items.map((i) => i.name).join(' + ');
  const t = sum.totals;
  return (
    <article
      aria-label={`저장한 조합: ${names}`}
      className="rounded-2xl border border-neutral-300 p-4 dark:border-neutral-600"
    >
      <header className="mb-2 flex items-center justify-between text-sm">
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
          {MEAL_LABELS[saved.mealType]}
        </span>
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          {savedDateText(saved.savedAt)} 저장
        </span>
      </header>
      <ul className="space-y-1 text-sm">
        {sum.items.map((i) => (
          <li key={i.name} className="flex justify-between gap-2">
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
      {sum.oils.length > 0 && (
        <p className="mt-2 text-sm">
          조리용 기름: {sum.oils.map((o) => `${o.name} ${o.grams}g`).join(', ')}
        </p>
      )}
      {sum.seasonings.length > 0 && (
        <p className="mt-1 text-sm">
          양념: {sum.seasonings.map((x) => `${x.name} ${x.text}`).join(', ')}
        </p>
      )}
      <p className="mt-3 rounded-lg bg-neutral-100 p-2 text-sm dark:bg-neutral-800">
        <span className="font-semibold">{t.kcal}kcal</span> · 단백질 {t.protein}
        g · 총탄수 {t.carbs}g · 지방 {t.fat}g · 식이섬유 {t.fiber}g · 나트륨{' '}
        {t.sodium}mg
      </p>
      <div className="mt-3 flex items-center justify-end gap-2">
        {confirming ? (
          <>
            <span className="mr-auto text-sm">삭제할까요?</span>
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 rounded-lg border border-neutral-300 px-4 dark:border-neutral-600"
            >
              취소
            </button>
            <button
              type="button"
              aria-label={`${names} 삭제 확인`}
              onClick={onDelete}
              className="min-h-11 rounded-lg bg-red-600 px-4 font-semibold text-white"
            >
              삭제
            </button>
          </>
        ) : (
          <button
            type="button"
            aria-label={`${names} 삭제`}
            onClick={onAskDelete}
            className="min-h-11 rounded-lg border border-neutral-300 px-4 dark:border-neutral-600"
          >
            삭제
          </button>
        )}
      </div>
    </article>
  );
}
