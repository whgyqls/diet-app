'use client';

import { useEffect } from 'react';
import { UNDO_TOAST_MS } from '@/lib/ui-labels';

/** "… [되돌리기]" toast that closes itself after UNDO_TOAST_MS. Re-keyed by the caller for each action. */
export function UndoToast({
  message,
  onUndo,
  onClose,
  durationMs = UNDO_TOAST_MS,
}: {
  message: string;
  onUndo: () => void;
  onClose: () => void;
  /** Time left to undo (default: the full UNDO_TOAST_MS). */
  durationMs?: number;
}) {
  useEffect(() => {
    const t = window.setTimeout(onClose, durationMs);
    return () => window.clearTimeout(t);
  }, [onClose, durationMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-24 z-40 mx-auto flex w-[calc(100%-2rem)] max-w-md items-center gap-3 rounded-xl bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="min-h-11 rounded-lg px-3 font-semibold text-emerald-300 underline dark:text-emerald-700"
      >
        되돌리기
      </button>
    </div>
  );
}
