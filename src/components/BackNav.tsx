'use client';

import { useRouter } from 'next/navigation';
import { markPopped, nav, previousPath } from '@/lib/nav/backState';

/**
 * "← 이전 화면". Goes back when the app itself knows the previous screen (a link was followed), otherwise to
 * `fallback`, the screen's parent. `flush`: the page already has its own side padding.
 */
export function BackNav({
  fallback,
  flush = false,
}: {
  fallback: string;
  flush?: boolean;
}) {
  const router = useRouter();
  return (
    <nav
      aria-label="화면 이동"
      className={flush ? '' : 'mx-auto w-full max-w-md px-4 pt-2'}
    >
      <button
        type="button"
        onClick={() => {
          if (previousPath(nav)) return router.back();
          // Going up to the parent is not a move to remember: from there the button goes further up, never
          // back down (that would send the user round in circles between two screens).
          markPopped(nav);
          router.push(fallback);
        }}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg pr-3 text-sm font-medium text-emerald-800 dark:text-emerald-300"
      >
        <span aria-hidden>←</span> 이전 화면
      </button>
    </nav>
  );
}
