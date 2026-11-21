// Saved (★) combos. A snapshot of what was eaten, not a reference to a comboKey: keys and card ids change
// when a card is swapped or rerolled. SavedStore is the single source; Phase 5 swaps in a server version.
import type { MealCombo, MealType, NutrientTotals } from '@/types/nutrition';
import { safeLocalStorage, type StateStorage } from '@/lib/store/safeStorage';

export const SAVED_STORAGE_KEY = 'diet-app-saved-v1';
const SAVED_VERSION = 1;

export type SavedItem = {
  foodId: string;
  name: string;
  grams: number;
  basis: 'raw' | 'cooked';
};
export type SavedSeasoning = {
  id: string;
  name: string;
  units: number;
  unitLabel: string;
};
export type SavedCombo = {
  id: string;
  savedAt: number; // ms since epoch
  mealType: MealType;
  requestFingerprint: string;
  /** comboSignature at save time: decides whether a card shows ★. */
  signature: string;
  items: SavedItem[];
  oils: SavedItem[];
  seasonings: SavedSeasoning[];
  totals: NutrientTotals;
};

/** Same foods with the same weights = same signature, whatever the item order. */
export function comboSignature(c: MealCombo): string {
  const part = (list: MealCombo['items']) =>
    list
      .map((i) => `${i.food.id}:${i.grams}`)
      .sort()
      .join(',');
  return `${part(c.items)}|${part(c.oils)}`;
}

export function snapshotOf(
  c: MealCombo,
  meta: {
    id: string;
    mealType: MealType;
    requestFingerprint: string;
    savedAt: number;
  },
): SavedCombo {
  const item = (i: MealCombo['items'][number]): SavedItem => ({
    foodId: i.food.id,
    name: i.food.name,
    grams: i.grams,
    basis: i.food.basis,
  });
  return {
    ...meta,
    signature: comboSignature(c),
    items: c.items.map(item),
    oils: c.oils.map(item),
    seasonings: c.seasonings.picks.map((p) => ({
      id: p.seasoning.id,
      name: p.seasoning.name,
      units: p.units,
      unitLabel: p.seasoning.unit.label,
    })),
    totals: { ...c.totals },
  };
}

export type SavedStore = {
  /** Newest first. The same array until something changes. */
  list(): SavedCombo[];
  has(signature: string): boolean;
  /** False (and nothing changes) when that signature is already saved. */
  add(s: SavedCombo): boolean;
  remove(id: string): void;
  removeBySignature(signature: string): void;
  subscribe(fn: () => void): () => void;
};

function parse(raw: string | null): SavedCombo[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as { items?: unknown };
    if (!v || !Array.isArray(v.items)) return [];
    return v.items.filter(
      (x): x is SavedCombo =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as SavedCombo).id === 'string' &&
        typeof (x as SavedCombo).signature === 'string' &&
        Array.isArray((x as SavedCombo).items),
    );
  } catch {
    return [];
  }
}

/** Storage failures never throw: the list then lives in memory for this page visit. */
export function createSavedStore(
  storage: StateStorage = safeLocalStorage(),
): SavedStore {
  let cache: SavedCombo[] | null = null;
  const listeners = new Set<() => void>();
  const load = (): SavedCombo[] => {
    if (cache) return cache;
    let raw: string | null = null;
    try {
      raw = storage.getItem(SAVED_STORAGE_KEY);
    } catch {}
    cache = parse(raw);
    return cache;
  };
  const commit = (next: SavedCombo[]) => {
    cache = next;
    try {
      storage.setItem(
        SAVED_STORAGE_KEY,
        JSON.stringify({ version: SAVED_VERSION, items: next }),
      );
    } catch {}
    listeners.forEach((fn) => fn());
  };
  return {
    list: load,
    has: (sig) => load().some((s) => s.signature === sig),
    add(s) {
      const cur = load();
      if (cur.some((x) => x.signature === s.signature)) return false;
      commit([s, ...cur]);
      return true;
    },
    remove(id) {
      const cur = load();
      if (cur.some((x) => x.id === id)) commit(cur.filter((x) => x.id !== id));
    },
    removeBySignature(sig) {
      const cur = load();
      if (cur.some((x) => x.signature === sig))
        commit(cur.filter((x) => x.signature !== sig));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

/** The app-wide store (localStorage). */
export const savedStore: SavedStore = createSavedStore();
