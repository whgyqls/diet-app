'use client';

import { useState } from 'react';
import { localKeysToRemove } from '@/lib/account/deleteRequest';
import { LEGACY_CLAIM_KEY, parseClaim } from '@/lib/legacy/legacyClaim';
import { createClient } from '@/lib/supabase/client';
import {
  safeLocalStorage,
  safeLocalStorageKeys,
} from '@/lib/store/safeStorage';

export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    setBusy(true);
    setFailed(false);
    const supabase = createClient();
    let uid: string | null = null;
    try {
      uid = (await supabase.auth.getSession()).data.session?.user.id ?? null;
      // No body and no id: the server uses the signed-in session only.
      const res = await fetch('/api/account', { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }
    // The account is gone. From here on nothing may stop the cleanup.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    try {
      const storage = safeLocalStorage();
      if (uid) {
        const claim = parseClaim(storage.getItem(LEGACY_CLAIM_KEY));
        for (const key of localKeysToRemove(uid, safeLocalStorageKeys(), claim))
          storage.removeItem(key);
      }
    } catch {
      // storage unavailable: nothing stored to remove
    }
    // A full load drops the in-memory state, so nothing writes the removed cache again.
    window.location.replace('/');
  }

  if (!confirming)
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex min-h-12 items-center justify-center rounded-lg border border-red-600 px-4 font-medium text-red-700 dark:border-red-400 dark:text-red-300"
      >
        계정 삭제
      </button>
    );

  return (
    <section
      aria-labelledby="delete-account-title"
      className="rounded-lg border border-red-600 p-4 dark:border-red-400"
    >
      <h2 id="delete-account-title" className="font-bold">
        계정을 삭제할까요?
      </h2>
      <p className="mt-2 text-sm">
        프로필, 재료 선택, 내 재료 세트, 저장한 조합(★), 식단 기록이 모두
        삭제되고 되돌릴 수 없어요. 이 브라우저에 남은 기록도 함께 지워져요.
      </p>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          삭제하지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      )}
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setFailed(false);
          }}
          disabled={busy}
          className="flex min-h-12 flex-1 items-center justify-center rounded-lg border border-neutral-300 px-4 font-medium disabled:opacity-60 dark:border-neutral-600"
        >
          취소
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="flex min-h-12 flex-1 items-center justify-center rounded-lg bg-red-700 px-4 font-medium text-white disabled:opacity-60"
        >
          {busy ? '삭제 중…' : '계정 삭제'}
        </button>
      </div>
    </section>
  );
}
