// Ids that exist in the current data. Shared by the app store, kits and the validators (src/lib/validate).
import { OIL_GROUP } from '@/lib/nutrition/constants';
import type { KnownIds } from '@/lib/kits/kits';
import { FOODS, SEASONINGS } from './load';

/** Oils used to be seasonings; older saves still list them there (see migrateSelection). */
export const OIL_IDS = FOODS.filter((f) => f.group === OIL_GROUP).map(
  (f) => f.id,
);

export const KNOWN_IDS: KnownIds = {
  foods: new Set(FOODS.map((f) => f.id)),
  seasonings: new Set(SEASONINGS.map((s) => s.id)),
  oilIds: OIL_IDS,
};
