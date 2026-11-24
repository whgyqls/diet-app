'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { ConfirmDialog } from '@/components/select/ConfirmDialog';
import { UndoToast } from '@/components/select/UndoToast';
import type { LegacyOffer } from '@/lib/account/runtime';
import {
  getAccountRuntime,
  useAccountSnapshot,
} from '@/lib/account/useAccount';
import {
  RESTORE_FAILED_MESSAGE,
  RESTORE_PARTIAL_MESSAGE,
  UNDO_DONE_MESSAGE,
  UNDO_FAILED_MESSAGE,
  confirmBody,
  doneMessage,
} from '@/lib/legacy/messages';
import { restoreUi } from '@/lib/legacy/restoreUi';

/**
 * "이전 기록 불러오기" (PLAN.md 9.2). Shown only while this account has not loaded the record on any device,
 * this browser still holds one nobody else claimed, and the account data is ready. Everything it does is
 * decided by planRestore; this only asks, runs and tells. The result line and the undo window live in
 * restoreUi (the screen unmounts while the data loads again).
 */
export function LegacyRestore() {
  const snap = useAccountSnapshot();
  const savedStatus = useSyncExternalStore(
    snap.savedStore.subscribe,
    snap.savedStore.status,
    () => 'loading' as const,
  );
  const ui = useSyncExternalStore(
    restoreUi.subscribe,
    restoreUi.get,
    restoreUi.get,
  );
  const [confirm, setConfirm] = useState<LegacyOffer | null>(null);
  // `ui` is a dependency on purpose: after a run the claim has changed
  const offer = useMemo(
    () => getAccountRuntime().legacyOffer(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap.uid, snap.phase, snap.legacyImportedAt, savedStatus, ui],
  );

  async function run() {
    restoreUi.set({ busy: true, message: null, undoSince: null });
    const result = await getAccountRuntime().restoreLegacy();
    if (result.status === 'failed') {
      restoreUi.set({
        busy: false,
        message: result.wrote
          ? RESTORE_PARTIAL_MESSAGE
          : RESTORE_FAILED_MESSAGE,
      });
      return;
    }
    restoreUi.set({
      busy: false,
      message: doneMessage(result.plan, result.dropped),
      undoSince: result.undoable ? Date.now() : null,
    });
  }

  function press() {
    const o = getAccountRuntime().legacyOffer();
    if (!o || ui.busy) return;
    if (o.plan.needsConfirm) setConfirm(o);
    else void run();
  }

  async function takeBack() {
    restoreUi.set({ busy: true, undoSince: null });
    try {
      await getAccountRuntime().undoLegacy();
      restoreUi.set({ busy: false, message: UNDO_DONE_MESSAGE });
    } catch {
      restoreUi.set({ busy: false, message: UNDO_FAILED_MESSAGE });
    }
  }

  return (
    <>
      {offer && (
        <section
          aria-label="이전 기록"
          className="rounded-lg border border-neutral-300 p-3 dark:border-neutral-600"
        >
          <p className="text-sm">
            이 브라우저에 로그인하기 전에 쓰던 기록(프로필, 고른 재료, 내 재료
            세트, ★)이 있어요.
          </p>
          <button
            type="button"
            onClick={press}
            disabled={ui.busy}
            className="mt-2 flex min-h-12 w-full items-center justify-center rounded-lg border border-emerald-600 px-4 font-medium text-emerald-800 disabled:opacity-60 dark:text-emerald-300"
          >
            {ui.busy ? '불러오는 중…' : '이전 기록 불러오기'}
          </button>
        </section>
      )}
      {ui.message && (
        <p
          role="status"
          className="rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-800"
        >
          {ui.message}
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          title="이전 기록을 불러올까요?"
          body={confirmBody(confirm.plan)}
          confirmLabel="불러오기"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void run();
          }}
        />
      )}
      {ui.undoSince !== null && (
        <UndoToast
          key={ui.undoSince}
          message="이전 기록을 불러왔어요"
          onUndo={() => void takeBack()}
          onClose={() => restoreUi.set({ undoSince: null })}
        />
      )}
    </>
  );
}
