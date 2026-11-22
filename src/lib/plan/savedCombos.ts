// Saved (★) combos. A snapshot of what was eaten, not a reference to a comboKey: keys and card ids change
// when a card is swapped or rerolled. SavedStore is the single source: the localStorage version lives here
// (also used to read the old record), the Supabase version comes in Phase 5d.
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

export type SavedStatus = 'loading' | 'ready' | 'error';

/**
 * Async because the server version is. Changes are optimistic: list() already shows the result when the call
 * returns its promise, and a failure rolls the list back and rejects.
 */
export type SavedStore = {
  /** Newest added first. The same array until something changes (useSyncExternalStore). */
  list(): SavedCombo[];
  status(): SavedStatus;
  subscribe(fn: () => void): () => void;
  /** Loads again from the source (retry after an error, pick up changes from another device). */
  refresh(): Promise<void>;
  /** The star: removes the combo when its signature is saved, saves it otherwise. */
  toggle(s: SavedCombo): Promise<'added' | 'removed'>;
  remove(id: string): Promise<void>;
  /** Restore of the previous record: skips signatures already saved. Resolves with the ids it added (for undo). */
  addMany(list: SavedCombo[]): Promise<string[]>;
};

/** Whether the combo with this signature is starred. */
export const isSaved = (list: readonly SavedCombo[], signature: string) =>
  list.some((s) => s.signature === signature);

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
export function createLocalSavedStore(
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
    status: () => 'ready',
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    async refresh() {
      cache = null;
      load();
      listeners.forEach((fn) => fn());
    },
    // The work happens before the first await, so list() is already updated when the promise is returned.
    async toggle(s) {
      const cur = load();
      if (cur.some((x) => x.signature === s.signature)) {
        commit(cur.filter((x) => x.signature !== s.signature));
        return 'removed';
      }
      commit([s, ...cur]);
      return 'added';
    },
    async remove(id) {
      const cur = load();
      if (cur.some((x) => x.id === id)) commit(cur.filter((x) => x.id !== id));
    },
    async addMany(list) {
      const cur = load();
      const seen = new Set(cur.map((x) => x.signature));
      const added: SavedCombo[] = [];
      for (const s of list) {
        if (seen.has(s.signature)) continue;
        seen.add(s.signature);
        added.push(s);
      }
      if (added.length > 0) commit([...added, ...cur]);
      return added.map((x) => x.id);
    },
  };
}

/** The app-wide store (localStorage). */
export const savedStore: SavedStore = createLocalSavedStore();
