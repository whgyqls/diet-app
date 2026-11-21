// "내 재료 세트": named snapshots of the selection (and optionally the styles). Pure functions.
// Kept in localStorage for now; PLAN.md 6.3 `ingredient_kits` is the Supabase table for Phase 5.
import type { DietStyle, PrefStatus, Selection } from '@/types/nutrition';
import { migrateSelection } from '@/lib/selection/selection';

export const KIT_NAME_MAX = 20;

export type IngredientKit = {
  id: string;
  name: string;
  selection: Selection;
  /** Present only when the user chose to save the styles with the kit. */
  styles?: DietStyle[];
  createdAt: number;
  updatedAt: number;
};

export type KitNameError = 'EMPTY' | 'TOO_LONG' | 'DUPLICATE';
export type KitApplyMode = 'replace' | 'merge';

/** Ids that exist in the current data; `oilIds` were seasonings in older saves. */
export type KnownIds = {
  foods: ReadonlySet<string>;
  seasonings: ReadonlySet<string>;
  oilIds: readonly string[];
};

export function validateKitName(
  name: string,
  kits: readonly IngredientKit[],
  exceptId?: string,
): KitNameError | null {
  const n = name.trim();
  if (n.length === 0) return 'EMPTY';
  if ([...n].length > KIT_NAME_MAX) return 'TOO_LONG';
  if (kits.some((k) => k.id !== exceptId && k.name === n)) return 'DUPLICATE';
  return null;
}

const copySelection = (s: Selection): Selection => ({
  foods: { ...s.foods },
  seasonings: { ...s.seasonings },
});

export function createKit(args: {
  id: string;
  name: string;
  selection: Selection;
  styles?: DietStyle[];
  now: number;
}): IngredientKit {
  return {
    id: args.id,
    name: args.name.trim(),
    selection: copySelection(args.selection),
    ...(args.styles ? { styles: [...args.styles] } : {}),
    createdAt: args.now,
    updatedAt: args.now,
  };
}

export function renameKit(
  kits: readonly IngredientKit[],
  id: string,
  name: string,
  now: number,
): IngredientKit[] {
  return kits.map((k) =>
    k.id === id ? { ...k, name: name.trim(), updatedAt: now } : k,
  );
}

export function deleteKit(
  kits: readonly IngredientKit[],
  id: string,
): IngredientKit[] {
  return kits.filter((k) => k.id !== id);
}

export function kitItemCount(kit: IngredientKit): number {
  return (
    Object.keys(kit.selection.foods).length +
    Object.keys(kit.selection.seasonings).length
  );
}

const rank = (s: PrefStatus | undefined) =>
  s === 'favorite' ? 2 : s === 'ok' ? 1 : 0;

function mergePrefs(
  a: Record<string, PrefStatus>,
  b: Record<string, PrefStatus>,
): Record<string, PrefStatus> {
  const out = { ...a };
  for (const [id, s] of Object.entries(b))
    if (rank(s) > rank(out[id])) out[id] = s;
  return out;
}

const keepKnown = (
  prefs: Record<string, PrefStatus>,
  known: ReadonlySet<string>,
) => Object.fromEntries(Object.entries(prefs).filter(([id]) => known.has(id)));

/**
 * Applies a kit to the current state. replace = the kit's selection (and its styles, if saved);
 * merge = union of both, favorite wins on overlap (styles added). Unknown ids are dropped.
 */
export function applyKit(
  current: { selection: Selection; styles: DietStyle[] },
  kit: IngredientKit,
  mode: KitApplyMode,
  known: KnownIds,
): { selection: Selection; styles: DietStyle[] } {
  const migrated = migrateSelection(kit.selection, known.oilIds);
  const fromKit: Selection = {
    foods: keepKnown(migrated.foods, known.foods),
    seasonings: keepKnown(migrated.seasonings, known.seasonings),
  };
  const selection =
    mode === 'replace'
      ? fromKit
      : {
          foods: mergePrefs(current.selection.foods, fromKit.foods),
          seasonings: mergePrefs(
            current.selection.seasonings,
            fromKit.seasonings,
          ),
        };
  const styles = !kit.styles
    ? current.styles
    : mode === 'replace'
      ? [...kit.styles]
      : [...new Set([...current.styles, ...kit.styles])];
  return { selection, styles };
}
