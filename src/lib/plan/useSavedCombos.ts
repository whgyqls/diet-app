'use client';
// Subscribes a screen to the saved combos: the list, the load status and the actions.
// Without an argument it is the signed-in user's store (Supabase, see src/lib/account/runtime.ts); any SavedStore works.
import { useSyncExternalStore } from 'react';
import { useAccountSnapshot } from '@/lib/account/useAccount';
import type { SavedCombo, SavedStore } from './savedCombos';

const NO_SAVED: SavedCombo[] = [];
const never = () => () => {};

export function useSavedCombos(given?: SavedStore) {
  const account = useAccountSnapshot().savedStore;
  const store = given ?? account;
  const list = useSyncExternalStore(
    store.subscribe,
    store.list,
    () => NO_SAVED,
  );
  const status = useSyncExternalStore(
    store.subscribe,
    store.status,
    () => 'loading' as const,
  );
  // false while rendering on the server and during hydration, so "empty" never flashes before the list.
  const ready = useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
  return {
    list,
    status,
    ready,
    remove: store.remove,
    toggle: store.toggle,
    refresh: store.refresh,
  };
}
