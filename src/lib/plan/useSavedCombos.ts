'use client';
// Subscribes a screen to the saved combos. Only list/remove/subscribe are used, so Phase 5 only has to
// provide another SavedStore implementation (the server one) and pass it here or change the default.
import { useSyncExternalStore } from 'react';
import { savedStore, type SavedCombo, type SavedStore } from './savedCombos';

export type SavedListSource = Pick<SavedStore, 'list' | 'remove' | 'subscribe'>;

const NO_SAVED: SavedCombo[] = [];
const never = () => () => {};

export function useSavedCombos(store: SavedListSource = savedStore) {
  const list = useSyncExternalStore(
    store.subscribe,
    store.list,
    () => NO_SAVED,
  );
  // false while rendering on the server and during hydration, so "empty" never flashes before the list.
  const ready = useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
  return { list, ready, remove: store.remove };
}
