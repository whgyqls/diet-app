'use client';
import { useEffect, useState } from 'react';
import { useAppStore } from './appStore';

/** Rehydrates the persisted store on the client; false until done (avoids SSR mismatch). */
export function useHydrated(): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.resolve(useAppStore.persist.rehydrate()).then(() => {
      if (alive) setDone(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return done;
}
