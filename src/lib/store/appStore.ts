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
  migrateSelection,
  selectAll,
  toggleItem,
} from '@/lib/selection/selection';
import { KNOWN_IDS as KNOWN, OIL_IDS } from '@/lib/data/knownIds';
import { safeLocalStorage, type StateStorage } from './safeStorage';

export type { StateStorage };
import {
  applyKit,
  createKit,
  deleteKit,
  renameKit,
  validateKitName,
  type IngredientKit,
  type KitApplyMode,
  type KitNameError,
} from '@/lib/kits/kits';

export const STORAGE_KEY = 'diet-app-v1';
export const DEFAULT_STEP = 0;
/** 2: oils moved from seasonings to foods, ingredient kits added. */
const STORE_VERSION = 2;

/** Short unique id; crypto.randomUUID is missing on plain-http LAN addresses (phone testing). */
const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export type AppState = {
  profile: Partial<Profile>;
  styles: DietStyle[];
  overrides: TargetOverrides;
  selection: Selection;
  step: number;
  kits: IngredientKit[];
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
  /** Called when /select opens: always begin at the first step. The choices themselves stay. */
  startSelection: () => void;
  /** Swaps the whole selection (reset all, undo, kit load). */
  replaceSelection: (sel: Selection) => void;
  replaceStyles: (styles: DietStyle[]) => void;
  /** Saves the current selection (and styles when asked). Returns the name error, or null when saved. */
  saveKit: (name: string, withStyles: boolean) => KitNameError | null;
  renameKit: (id: string, name: string) => KitNameError | null;
  deleteKit: (id: string) => void;
  loadKit: (id: string, mode: KitApplyMode) => void;
};

export function createAppStore(storage: StateStorage = safeLocalStorage()) {
  return create<AppState>()(
    persist(
      (set, get) => ({
        profile: {},
        styles: [],
        overrides: {},
        selection: EMPTY_SELECTION,
        step: DEFAULT_STEP,
        kits: [],
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
        startSelection: () => set({ step: DEFAULT_STEP }),
        replaceSelection: (selection) => set({ selection }),
        replaceStyles: (styles) => set({ styles }),
        saveKit: (name, withStyles) => {
          const s = get();
          const err = validateKitName(name, s.kits);
          if (err) return err;
          const kit = createKit({
            id: newId(),
            name,
            selection: s.selection,
            ...(withStyles ? { styles: s.styles } : {}),
            now: Date.now(),
          });
          set({ kits: [...s.kits, kit] });
          return null;
        },
        renameKit: (id, name) => {
          const s = get();
          const err = validateKitName(name, s.kits, id);
          if (err) return err;
          set({ kits: renameKit(s.kits, id, name, Date.now()) });
          return null;
        },
        deleteKit: (id) => set((s) => ({ kits: deleteKit(s.kits, id) })),
        loadKit: (id, mode) => {
          const s = get();
          const kit = s.kits.find((k) => k.id === id);
          if (!kit) return;
          set(applyKit(s, kit, mode, KNOWN));
        },
      }),
      {
        name: STORAGE_KEY,
        version: STORE_VERSION,
        storage: createJSONStorage(() => storage),
        skipHydration: true,
        partialize: (s) => ({
          profile: s.profile,
          styles: s.styles,
          overrides: s.overrides,
          selection: s.selection,
          step: s.step,
          kits: s.kits,
        }),
        migrate: (persisted, version) => {
          const p = (persisted ?? {}) as Partial<AppState>;
          if (version < 2) {
            return {
              ...p,
              selection: migrateSelection(
                p.selection ?? EMPTY_SELECTION,
                OIL_IDS,
              ),
              kits: [],
            };
          }
          return p;
        },
      },
    ),
  );
}

export const useAppStore = createAppStore();
