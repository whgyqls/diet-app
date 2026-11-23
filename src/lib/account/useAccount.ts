'use client';
// React side of the account runtime (runtime.ts): one runtime for the page, read with useSyncExternalStore.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import {
  safeLocalStorage,
  safeLocalStorageKeys,
} from '@/lib/store/safeStorage';
import { gateFor, type Gate } from '@/lib/supabase/accountGate';
import { createClient } from '@/lib/supabase/client';
import { ACCOUNT_LOAD_TIMEOUT_MS } from '@/lib/supabase/syncConstants';
import {
  INITIAL_SNAPSHOT,
  createAccountRuntime,
  type AccountRuntime,
  type AccountSnapshot,
} from './runtime';

let runtime: AccountRuntime | null = null;

/** The page's runtime, created on first use in the browser. */
export function getAccountRuntime(): AccountRuntime {
  runtime ??= createAccountRuntime({
    client: createClient(),
    appStore: useAppStore,
    storage: { ...safeLocalStorage(), keys: safeLocalStorageKeys },
  });
  return runtime;
}

const subscribe = (fn: () => void) => getAccountRuntime().subscribe(fn);
const getSnapshot = () => getAccountRuntime().getSnapshot();
// What the server renders and the browser hydrates with: session not known yet.
const getServerSnapshot = () => INITIAL_SNAPSHOT;

export function useAccountSnapshot(): AccountSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * May this screen show its content? wait = "불러오는 중…", ready = show it, readonly = show it but nothing can
 * be changed (data could not be loaded). Never waits longer than ACCOUNT_LOAD_TIMEOUT_MS, and a signed-out
 * visitor is ready at once (gateFor in src/lib/supabase/accountGate.ts).
 */
export function useAccountGate(): Gate {
  const { session, phase } = useAccountSnapshot();
  const [timedOut, setTimedOut] = useState(false);
  const waiting = gateFor({ session, phase, waitedMs: 0 }) === 'wait';
  useEffect(() => {
    if (!waiting) return;
    const id = setTimeout(() => setTimedOut(true), ACCOUNT_LOAD_TIMEOUT_MS);
    return () => {
      clearTimeout(id);
      setTimedOut(false);
    };
  }, [waiting]);
  return gateFor({
    session,
    phase,
    waitedMs: timedOut ? ACCOUNT_LOAD_TIMEOUT_MS : 0,
  });
}
