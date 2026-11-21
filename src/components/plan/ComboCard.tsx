'use client';

import {
  BONUS_BADGE_LABELS,
  badgeContributions,
  bonusBadges,
} from '@/lib/nutrition/badges';
import { PROTEIN_GROUP_LABELS } from '@/lib/nutrition/constants';
import { comboProteinGroup } from '@/lib/nutrition/generate';
import {
  BASIS_SHORT,
  SEASONING_REASON_TEXT,
  UNMET_LABELS,
} from '@/lib/ui-labels';
import type { MealCombo } from '@/types/nutrition';

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Number(n.toFixed(1));

/** One recommended combination. Numbers are shown as the engine computed them. */
export function ComboCard({
  combo,
  index,
  total,
  picked,
  onPick,
}: {
  combo: MealCombo;
  index: number;
  total: number;
  picked: boolean;
  onPick: () => void;
}) {
  const group = comboProteinGroup(combo);
  const contributions = badgeContributions(combo.items);
  const { seasonings: seas, totals: t } = combo;
  return (
    <article
      aria-label={`조합 ${index + 1} / ${total}`}
      className={`flex h-full flex-col rounded-2xl border p-4 ${picked ? 'border-emerald-600 ring-2 ring-emerald-600' : 'border-neutral-300 dark:border-neutral-600'}`}
    >
      <header className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold">
          조합 {index + 1} / {total}
        </span>
        {group && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
            {PROTEIN_GROUP_LABELS[group]}
          </span>
        )}
      </header>

      <ul className="space-y-2">
        {combo.items.map(({ food, grams }) => (
          <li key={food.id} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{food.name}</span>
              <span>
                {grams}g
                <span className="ml-1 text-xs text-neutral-500">
                  ({BASIS_SHORT[food.basis]})
                </span>
              </span>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              {food.cookingHint}
            </p>
            {bonusBadges(food).length > 0 && (
              <p className="mt-0.5 flex flex-wrap gap-1">
                {bonusBadges(food).map((b) => (
                  <span
                    key={b}
                    className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100"
                  >
                    {BONUS_BADGE_LABELS[b]}
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>

      {contributions.length > 0 && (
        <ul className="mt-2 text-xs text-neutral-700 dark:text-neutral-300">
          {contributions.map((c) => (
            <li key={c.nutrient}>
              {UNMET_LABELS[c.nutrient]} {r0(c.total)}g 중{' '}
              {c.items.map((i) => `${i.food.name} ${r0(i.amount)}g`).join(', ')}
            </li>
          ))}
        </ul>
      )}

      {combo.oils.length > 0 && (
        <section className="mt-3 text-sm">
          <h3 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            조리용 기름
          </h3>
          {combo.oils.map(({ food, grams }) => (
            <p key={food.id}>
              {food.name} {r1(grams)}g
            </p>
          ))}
        </section>
      )}

      <section className="mt-3 text-sm">
        <h3 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
          양념 권장량
        </h3>
        {seas.picks.map((p) => (
          <p key={p.seasoning.id}>
            {p.seasoning.name} {r1(p.units)}
            {p.seasoning.unit.label}
          </p>
        ))}
        {seas.free.length > 0 && (
          <p>자유롭게: {seas.free.map((f) => f.name).join(', ')}</p>
        )}
        {seas.picks.length === 0 && seas.reason && (
          <p className="text-xs">{SEASONING_REASON_TEXT[seas.reason]}</p>
        )}
      </section>

      <section className="mt-3 rounded-lg bg-neutral-100 p-2 text-sm dark:bg-neutral-800">
        <h3 className="sr-only">끼니 영양 합계</h3>
        <p className="font-semibold">{r0(t.kcal)}kcal</p>
        <p>
          단백질 {r0(t.protein)}g · 총탄수 {r0(t.carbs)}g · 지방 {r0(t.fat)}g ·
          식이섬유 {r0(t.fiber)}g · 나트륨 {r0(t.sodium)}mg
        </p>
        {combo.kcalWarning && (
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            이 끼니 목표 칼로리의 80%를 채우지 못했어요
          </p>
        )}
      </section>

      {/* Phase 6: AI explanation goes here. */}
      <div data-slot="ai-explain" />

      <div className="mt-auto pt-3">
        <button
          type="button"
          aria-pressed={picked}
          onClick={onPick}
          className={`min-h-11 w-full rounded-lg font-semibold ${picked ? 'border border-emerald-600 text-emerald-700 dark:text-emerald-300' : 'bg-emerald-600 text-white'}`}
        >
          {picked ? '선택됨' : '이 조합 선택'}
        </button>
      </div>
    </article>
  );
}
