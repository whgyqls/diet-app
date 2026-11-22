'use client';
// Subscribes a screen to the saved combos: the list, the load status and the actions.
// Any SavedStore works (localStorage now, the Supabase one after Phase 5d).
import { useSyncExternalStore } from 'react';
import { savedStore, type SavedCombo, type SavedStore } from './savedCombos';

const NO_SAVED: SavedCombo[] = [];
const never = () => () => {};

export function useSavedCombos(store: SavedStore = savedStore) {
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
