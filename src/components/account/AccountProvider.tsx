'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import {
  getAccountRuntime,
  useAccountGate,
  useAccountSnapshot,
} from '@/lib/account/useAccount';
import { isProtectedPath } from '@/lib/auth/routes';

/**
 * Wraps every page: starts the account runtime (who is signed in, loading and saving their data), shows the
 * "저장 중…" mark and the notices, warns before leaving with unsaved edits, and when the data could not be
 * loaded keeps the page visible but not editable.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const snap = useAccountSnapshot();
  const gate = useAccountGate();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => getAccountRuntime().start(), []);

  // Leaving while edits wait or are being written: ask first (the browser shows its own text).
  useEffect(() => {
    if (snap.save === 'idle') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [snap.save]);

  // Signed out (expired session, other tab) while on a page that needs a login.
  useEffect(() => {
    if (snap.session === 'signed-out' && isProtectedPath(pathname))
      router.replace('/');
  }, [snap.session, pathname, router]);

  const runtime = () => getAccountRuntime();
  return (
    <>
      <div
        aria-live="polite"
        className="pointer-events-none fixed top-3 right-3 z-40"
      >
        {snap.save !== 'idle' && (
          <span
            data-testid="save-status"
            className="rounded-full bg-neutral-900/80 px-3 py-1 text-xs text-white"
          >
            저장 중…
          </span>
        )}
      </div>
      {gate === 'readonly' && (
        <Notice tone="warn">
          <p>연결되지 않아 지금은 바꿀 수 없어요.</p>
          <button
            type="button"
            onClick={() => void runtime().retry()}
            className="mt-2 min-h-11 rounded-lg border border-current px-4 font-medium"
          >
            다시 시도
          </button>
        </Notice>
      )}
      {gate !== 'readonly' && snap.error && (
        <Notice tone="warn" alert>
          <p>저장하지 못했어요. 서버에 저장된 값으로 되돌렸어요.</p>
          <button
            type="button"
            onClick={() => runtime().clearError()}
            className="mt-2 min-h-11 rounded-lg border border-current px-4 font-medium"
          >
            닫기
          </button>
        </Notice>
      )}
      <div className="flex flex-1 flex-col" inert={gate === 'readonly'}>
        {children}
      </div>
    </>
  );
}

function Notice({
  tone,
  alert,
  children,
}: {
  tone: 'warn';
  alert?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-3" data-tone={tone}>
      <div
        role={alert ? 'alert' : undefined}
        className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
      >
        {children}
      </div>
    </div>
  );
}
