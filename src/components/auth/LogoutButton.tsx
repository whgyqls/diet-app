'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      // 'local': only this browser is logged out, not the user's other devices.
      await createClient().auth.signOut({ scope: 'local' });
    } finally {
      // Even if the call failed, leave: the proxy sends a signed-out visitor away from protected pages.
      router.replace('/');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="flex min-h-12 items-center justify-center rounded-lg border border-neutral-300 px-4 font-medium disabled:opacity-60 dark:border-neutral-600"
    >
      {busy ? '로그아웃 중…' : '로그아웃'}
    </button>
  );
}
