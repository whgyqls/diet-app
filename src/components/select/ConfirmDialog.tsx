'use client';

import { useEffect, useRef } from 'react';

/** Small in-app confirm (role="alertdialog"), used for reset all and kit delete. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onCancel();
    };
    // Capture phase so a sheet underneath does not also close on the same Escape.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? 'confirm-body' : undefined}
        className="w-full max-w-sm rounded-2xl bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-bold">
          {title}
        </h2>
        {body && (
          <p
            id="confirm-body"
            className="mt-1 text-sm text-neutral-700 dark:text-neutral-300"
          >
            {body}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-lg border border-neutral-300 font-medium dark:border-neutral-600"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-12 flex-1 rounded-lg bg-red-600 font-semibold text-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
