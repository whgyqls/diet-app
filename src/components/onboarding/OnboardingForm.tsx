'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { calcDayTargets } from '@/lib/nutrition/targets';
import { resolveStyles } from '@/lib/nutrition/styles';
import { computeFlags } from '@/lib/nutrition/flags';
import { daySummary } from '@/lib/nutrition/summary';
import {
  overridesFromDraft,
  parseProfile,
  type AdvancedDraft,
} from '@/lib/profile';
import { useAppStore } from '@/lib/store/appStore';
import { useHydrated } from '@/lib/store/useHydrated';
import {
  ACTIVITY_LABELS,
  DISCLAIMER,
  GOAL_LABELS,
  SEX_LABELS,
  STYLE_INFO,
  STYLE_ORDER,
} from '@/lib/ui-labels';
import type { ActivityLevel, Goal, MealsPerDay, Sex } from '@/types/nutrition';

const field =
  'min-h-11 w-full rounded-lg border border-neutral-300 bg-transparent px-3 text-base dark:border-neutral-600';
const seg = (on: boolean) =>
  `min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium ${
    on
      ? 'border-emerald-600 bg-emerald-600 text-white'
      : 'border-neutral-300 dark:border-neutral-600'
  }`;

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-sm font-medium">{children}</span>;
}

const toNum = (v: string) => (v.trim() === '' ? undefined : Number(v));

export function OnboardingForm() {
  const hydrated = useHydrated();
  if (!hydrated) return <p className="p-4">불러오는 중…</p>;
  return <Form />;
}

const str = (n: number | undefined) => (n === undefined ? '' : String(n));

function Form() {
  const { profile, styles, overrides, setProfile, toggleStyle, setOverrides } =
    useAppStore();
  const [adv, setAdv] = useState<AdvancedDraft>(() => ({
    sodiumMax: str(overrides.sodiumMax),
    proteinPerKg: str(
      overrides.protein && 'perKg' in overrides.protein
        ? overrides.protein.perKg
        : undefined,
    ),
    netCarbG: str(
      overrides.netCarbs && 'g' in overrides.netCarbs
        ? overrides.netCarbs.g
        : undefined,
    ),
    fatG: str(
      overrides.fat && 'g' in overrides.fat ? overrides.fat.g : undefined,
    ),
  }));
  const [advOpen, setAdvOpen] = useState(false);

  const valid = useMemo(() => parseProfile(profile), [profile]);

  const result = useMemo(() => {
    if (!valid) return undefined;
    const resolved = resolveStyles(styles, valid.goal);
    const year = new Date().getFullYear();
    const { targets, flags } = calcDayTargets(valid, year, overrides, resolved);
    return {
      summary: daySummary(targets),
      warnings: computeFlags({ profile: valid, targets, settingFlags: flags }),
    };
  }, [valid, styles, overrides]);

  const updateAdv = (patch: Partial<AdvancedDraft>) => {
    const next = { ...adv, ...patch };
    setAdv(next);
    setOverrides(overridesFromDraft(next));
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 p-4 pb-28">
      <h1 className="text-xl font-bold">프로필·목표 입력</h1>

      <div>
        <Label>성별</Label>
        <div className="flex gap-2">
          {(Object.keys(SEX_LABELS) as Sex[]).map((s) => (
            <button
              key={s}
              type="button"
              className={seg(profile.sex === s)}
              onClick={() => setProfile({ sex: s })}
            >
              {SEX_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label>
          <Label>출생연도</Label>
          <input
            className={field}
            inputMode="numeric"
            placeholder="1995"
            value={profile.birthYear ?? ''}
            onChange={(e) => setProfile({ birthYear: toNum(e.target.value) })}
          />
        </label>
        <label>
          <Label>키(cm)</Label>
          <input
            className={field}
            inputMode="decimal"
            placeholder="170"
            value={profile.heightCm ?? ''}
            onChange={(e) => setProfile({ heightCm: toNum(e.target.value) })}
          />
        </label>
        <label>
          <Label>체중(kg)</Label>
          <input
            className={field}
            inputMode="decimal"
            placeholder="65"
            value={profile.weightKg ?? ''}
            onChange={(e) => setProfile({ weightKg: toNum(e.target.value) })}
          />
        </label>
      </div>

      <div>
        <Label>활동량</Label>
        <div className="flex flex-col gap-2">
          {([1, 2, 3, 4, 5] as ActivityLevel[]).map((a) => (
            <button
              key={a}
              type="button"
              className={seg(profile.activityLevel === a) + ' text-left'}
              onClick={() => setProfile({ activityLevel: a })}
            >
              {a}단계 · {ACTIVITY_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>목표</Label>
        <div className="flex gap-2">
          {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
            <button
              key={g}
              type="button"
              className={seg(profile.goal === g)}
              onClick={() => setProfile({ goal: g })}
            >
              {GOAL_LABELS[g]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>하루 끼니 수</Label>
        <div className="flex gap-2">
          {([2, 3] as MealsPerDay[]).map((m) => (
            <button
              key={m}
              type="button"
              className={seg(profile.mealsPerDay === m)}
              onClick={() => setProfile({ mealsPerDay: m })}
            >
              {m}끼
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>식단 스타일 (선택, 여러 개 가능)</Label>
        <div className="flex flex-col gap-2">
          {STYLE_ORDER.map((s) => {
            const on = styles.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                className={`min-h-11 rounded-lg border px-3 py-2 text-left ${
                  on
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950'
                    : 'border-neutral-300 dark:border-neutral-600'
                }`}
                onClick={() => toggleStyle(s)}
              >
                <span className="block text-sm font-semibold">
                  {on ? '✓ ' : ''}
                  {STYLE_INFO[s].label}
                </span>
                <span className="block text-xs text-neutral-600 dark:text-neutral-400">
                  {STYLE_INFO[s].desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="rounded-lg border border-neutral-300 dark:border-neutral-600">
        <button
          type="button"
          aria-expanded={advOpen}
          className="min-h-11 w-full px-3 text-left text-sm font-semibold"
          onClick={() => setAdvOpen(!advOpen)}
        >
          고급 설정(선택) {advOpen ? '▲' : '▼'}
        </button>
        {advOpen && (
          <div className="grid grid-cols-2 gap-2 p-3 pt-0">
            <label>
              <Label>나트륨 상한(mg)</Label>
              <input
                className={field}
                inputMode="numeric"
                value={adv.sodiumMax}
                onChange={(e) => updateAdv({ sodiumMax: e.target.value })}
              />
            </label>
            <label>
              <Label>단백질(g/kg)</Label>
              <input
                className={field}
                inputMode="decimal"
                value={adv.proteinPerKg}
                onChange={(e) => updateAdv({ proteinPerKg: e.target.value })}
              />
            </label>
            <label>
              <Label>순탄수(g)</Label>
              <input
                className={field}
                inputMode="numeric"
                value={adv.netCarbG}
                onChange={(e) => updateAdv({ netCarbG: e.target.value })}
              />
            </label>
            <label>
              <Label>지방(g)</Label>
              <input
                className={field}
                inputMode="numeric"
                value={adv.fatG}
                onChange={(e) => updateAdv({ fatG: e.target.value })}
              />
            </label>
          </div>
        )}
      </section>

      <section
        aria-live="polite"
        className="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-900"
      >
        <h2 className="mb-2 text-sm font-bold">하루 목표</h2>
        {result ? (
          <>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt>칼로리</dt>
              <dd className="text-right">
                {result.summary.kcal.toLocaleString()} kcal
              </dd>
              <dt>단백질</dt>
              <dd className="text-right">
                {result.summary.protein.base}~{result.summary.protein.max} g
              </dd>
              <dt>순탄수</dt>
              <dd className="text-right">{result.summary.netCarbMax} g 이하</dd>
              <dt>지방</dt>
              <dd className="text-right">
                {result.summary.fat.min}~{result.summary.fat.max} g
              </dd>
              <dt>식이섬유</dt>
              <dd className="text-right">{result.summary.fiberMin} g 이상</dd>
              <dt>나트륨</dt>
              <dd className="text-right">
                {result.summary.sodiumMax.toLocaleString()} mg 이하
              </dd>
            </dl>
            {result.warnings.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {result.warnings.map((w) => (
                  <li
                    key={w.code}
                    className="rounded-md bg-amber-100 p-2 text-xs text-amber-900"
                  >
                    {w.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            모든 항목을 입력하면 하루 목표가 바로 표시돼요.
          </p>
        )}
      </section>

      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        {DISCLAIMER}
      </p>

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-background p-3 dark:border-neutral-800">
        <Link
          href="/select"
          className="mx-auto flex min-h-12 max-w-md items-center justify-center rounded-lg bg-emerald-600 font-semibold text-white"
        >
          재료 고르러 가기
        </Link>
      </div>
    </div>
  );
}
