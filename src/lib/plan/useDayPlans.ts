'use client';
// The signed-in user's day plans for /saved: the list, its load status, a retry and a delete.
import { useCallback, useEffect, useState } from 'react';
import { useAccountGate, useAccountSnapshot } from '@/lib/account/useAccount';
import { createClient } from '@/lib/supabase/client';
import { deleteDayPlan, listDayPlans } from '@/lib/supabase/dayPlansRemote';
import type { SavedDayPlan } from './dayPlans';

type Loaded = {
  uid: string;
  status: 'ready' | 'error';
  list: SavedDayPlan[];
};

export function useDayPlans() {
  const { uid } = useAccountSnapshot();
  const gate = useAccountGate();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!uid || gate === 'wait') return;
    let current = true;
    listDayPlans(createClient(), uid).then(
      (list) => current && setLoaded({ uid, status: 'ready', list }),
      () => current && setLoaded({ uid, status: 'error', list: [] }),
    );
    return () => {
      current = false;
    };
  }, [uid, gate, attempt]);

  // A result of another account (sign-out, user switch) is never shown.
  const mine = loaded && loaded.uid === uid ? loaded : null;
  const status: 'loading' | 'ready' | 'error' = mine ? mine.status : 'loading';

  const refresh = useCallback(() => {
    setLoaded(null);
    setAttempt((n) => n + 1);
  }, []);

  /** Deletes that date's plan, then drops it from the list. Rejects when the request fails (nothing changes). */
  const remove = useCallback(
    async (date: string) => {
      if (!uid) throw new Error('not signed in');
      await deleteDayPlan(createClient(), uid, date);
      setLoaded((l) =>
        l && l.uid === uid
          ? { ...l, list: l.list.filter((p) => p.date !== date) }
          : l,
      );
    },
    [uid],
  );

  return { status, list: mine?.list ?? [], refresh, remove };
}
