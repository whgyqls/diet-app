'use client';

import Link from 'next/link';
import { FOODS } from '@/lib/data/load';
import { isFoodExcludedByStyles } from '@/lib/nutrition/styleExclusion';
import { parseProfile } from '@/lib/profile';
import { selectionProblems } from '@/lib/selection/selection';
import { useAppStore } from '@/lib/store/appStore';
import { useHydrated } from '@/lib/store/useHydrated';

/** Start button, plus a "continue" link only after the saved state is loaded (no SSR mismatch). */
export function HomeActions() {
  const hydrated = useHydrated();
  return (
    <div className="mt-6 flex flex-col gap-3">
      <Link
        href="/onboarding"
        className="flex min-h-12 items-center justify-center rounded-lg bg-emerald-600 font-semibold text-white"
      >
        시작하기
      </Link>
      {hydrated && <Continue />}
      <Link
        href="/settings"
        className="flex min-h-11 items-center justify-center text-sm text-neutral-700 underline dark:text-neutral-300"
      >
        설정 · 로그아웃
      </Link>
    </div>
  );
}

function Continue() {
  const s = useAppStore();
  const profile = parseProfile(s.profile);
  if (!profile) return null;
  const ready =
    selectionProblems(s.selection, FOODS, (f) =>
      isFoodExcludedByStyles(f, s.styles, profile.goal),
    ).length === 0;
  return (
    <Link
      href={ready ? '/plan' : '/select'}
      className="flex min-h-11 items-center justify-center rounded-lg border border-neutral-300 font-medium dark:border-neutral-600"
    >
      {ready ? '이어서 추천 보기' : '이어서 재료 고르기'}
    </Link>
  );
}
