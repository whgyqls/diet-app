// The snapshot saved when a combo card's ★ is pressed. The id is a uuid (made here, so it is the same id in the
// list and in the saved_combos row), created with newUuid because crypto.randomUUID is missing on plain-http
// addresses (phone testing).
import { newUuid } from '@/lib/id/newUuid';
import type { MealCombo, MealType } from '@/types/nutrition';
import { snapshotOf, type SavedCombo } from './savedCombos';

export function newStarSnapshot(
  combo: MealCombo,
  mealType: MealType,
  requestFingerprint: string,
  now: number,
  makeId: () => string = newUuid,
): SavedCombo {
  return snapshotOf(combo, {
    id: makeId(),
    mealType,
    requestFingerprint,
    savedAt: now,
  });
}
