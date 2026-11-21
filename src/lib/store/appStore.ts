// App state (profile, styles, overrides, selection) kept in localStorage via zustand.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  DietStyle,
  Profile,
  Selection,
  TargetOverrides,
} from '@/types/nutrition';
import {
  EMPTY_SELECTION,
  clearAll,
  selectAll,
  toggleItem,
} from '@/lib/selection/selection';

export const STORAGE_KEY = 'diet-app-v1';
export const DEFAULT_STEP = 0;

export type AppState = {
  profile: Partial<Profile>;
  styles: DietStyle[];
  overrides: TargetOverrides;
  selection: Selection;
  step: number;
  setProfile: (patch: Partial<Profile>) => void;
  toggleStyle: (s: DietStyle) => void;
  setOverrides: (o: TargetOverrides) => void;
  toggleFood: (id: string) => void;
  toggleSeasoning: (id: string) => void;
  selectAllFoods: (ids: string[]) => void;
  clearAllFoods: (ids: string[]) => void;
  selectAllSeasonings: (ids: string[]) => void;
  clearAllSeasonings: (ids: string[]) => void;
  setStep: (n: number) => void;
};

export type StateStorage = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
};

/** Safe localStorage: returns a no-op storage when it is unavailable (private mode, SSR). */
function safeLocalStorage(): StateStorage {
  const noop: StateStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  if (typeof window === 'undefined') return noop;
  return {
    getItem: (k) => {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {}
    },
    removeItem: (k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {}
    },
  };
}

export function createAppStore(storage: StateStorage = safeLocalStorage()) {
  return create<AppState>()(
    persist(
      (set) => ({
        profile: {},
        styles: [],
        overrides: {},
        selection: EMPTY_SELECTION,
        step: DEFAULT_STEP,
        setProfile: (patch) =>
          set((s) => ({ profile: { ...s.profile, ...patch } })),
        toggleStyle: (style) =>
          set((s) => ({
            styles: s.styles.includes(style)
              ? s.styles.filter((x) => x !== style)
              : [...s.styles, style],
          })),
        setOverrides: (overrides) => set({ overrides }),
        toggleFood: (id) =>
          set((s) => ({ selection: toggleItem(s.selection, 'foods', id) })),
        toggleSeasoning: (id) =>
          set((s) => ({
            selection: toggleItem(s.selection, 'seasonings', id),
          })),
        selectAllFoods: (ids) =>
          set((s) => ({ selection: selectAll(s.selection, 'foods', ids) })),
        clearAllFoods: (ids) =>
          set((s) => ({ selection: clearAll(s.selection, 'foods', ids) })),
        selectAllSeasonings: (ids) =>
          set((s) => ({
            selection: selectAll(s.selection, 'seasonings', ids),
          })),
        clearAllSeasonings: (ids) =>
          set((s) => ({ selection: clearAll(s.selection, 'seasonings', ids) })),
        setStep: (step) => set({ step }),
      }),
      {
        name: STORAGE_KEY,
        version: 1,
        storage: createJSONStorage(() => storage),
        skipHydration: true,
        partialize: (s) => ({
          profile: s.profile,
          styles: s.styles,
          overrides: s.overrides,
          selection: s.selection,
          step: s.step,
        }),
      },
    ),
  );
}

export const useAppStore = createAppStore();
