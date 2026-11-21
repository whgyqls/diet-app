// Pure selection logic for /select (PLAN.md 3.2). Missing id = cannot eat.
import { OIL_GROUP } from '@/lib/nutrition/constants';
import { FAT_FILTERS, FAT_FILTER_OIL } from '@/lib/ui-labels';
import type { Food } from '@/types/food';
import type { PrefStatus, Selection } from '@/types/nutrition';

export type Pref = PrefStatus | undefined;

export const EMPTY_SELECTION: Selection = { foods: {}, seasonings: {} };

/** none -> ok -> favorite -> none */
export function cycleStatus(current: Pref): Pref {
  if (current === undefined) return 'ok';
  if (current === 'ok') return 'favorite';
  return undefined;
}

type Kind = keyof Selection;

export function toggleItem(sel: Selection, kind: Kind, id: string): Selection {
  const next = { ...sel[kind] };
  const status = cycleStatus(next[id]);
  if (status === undefined) delete next[id];
  else next[id] = status;
  return { ...sel, [kind]: next };
}

/** Selecting all keeps existing statuses (favorites stay favorites). */
export function selectAll(
  sel: Selection,
  kind: Kind,
  ids: string[],
): Selection {
  const next = { ...sel[kind] };
  for (const id of ids) next[id] ??= 'ok';
  return { ...sel, [kind]: next };
}

export function clearAll(sel: Selection, kind: Kind, ids: string[]): Selection {
  const next = { ...sel[kind] };
  for (const id of ids) delete next[id];
  return { ...sel, [kind]: next };
}

export type SelectionProblem = 'NEED_PROTEIN' | 'NEED_FIBER';

/**
 * Minimum condition: 1+ protein and 1+ fiber source. Foods left out by the chosen styles do not count.
 * Carbs, fat sources and seasonings may be empty.
 */
export function selectionProblems(
  sel: Selection,
  foods: readonly Food[],
  isExcluded: (f: Food) => boolean,
): SelectionProblem[] {
  const has = (cat: Food['category']) =>
    foods.some((f) => f.category === cat && sel.foods[f.id] && !isExcluded(f));
  const out: SelectionProblem[] = [];
  if (!has('protein')) out.push('NEED_PROTEIN');
  if (!has('fiber')) out.push('NEED_FIBER');
  return out;
}

export function countSelected(
  sel: Selection,
  kind: Kind,
  ids: readonly string[],
): number {
  return ids.filter((id) => sel[kind][id]).length;
}

/**
 * Moves `ids` (the oils, which used to be seasonings) from `seasonings` to `foods`, keeping their status.
 * A status already on the food side wins.
 */
export function migrateSelection(
  sel: Selection,
  ids: readonly string[],
): Selection {
  const foods = { ...sel.foods };
  const seasonings = { ...sel.seasonings };
  for (const id of ids) {
    const status = seasonings[id];
    if (status === undefined) continue;
    foods[id] ??= status;
    delete seasonings[id];
  }
  return { foods, seasonings };
}

export type StepFilter = { key: string; label: string };
type StepKey = Food['category'];

/** Filter chips for a step: the fat step splits whole foods and oils, other steps use the food groups. */
export function stepFilters(
  foods: readonly Food[],
  step: StepKey,
): StepFilter[] {
  if (step === 'fat') return [...FAT_FILTERS];
  return [...new Set(foods.map((f) => f.group))].map((g) => ({
    key: g,
    label: g,
  }));
}

/** Foods shown for a filter chip (`null` = all). */
export function filterStepFoods(
  foods: readonly Food[],
  step: StepKey,
  filter: string | null,
): Food[] {
  if (filter === null) return [...foods];
  if (step === 'fat') {
    const wantOil = filter === FAT_FILTER_OIL;
    return foods.filter((f) => (f.group === OIL_GROUP) === wantOil);
  }
  return foods.filter((f) => f.group === filter);
}
