// Plan screen state as a pure reducer. Plain data only (arrays/Records, no Set/Map).
// Phase 4a: loaded, pick, fingerprint. Phase 4b adds reroll, swap, lock, compare.
import type {
  DayPlan,
  MealCombo,
  MealTargets,
  MealType,
} from '@/types/nutrition';
import { summarizeDay, type SummarizeDayInput } from '@/lib/nutrition/day';

/** `id` stays the same when a card's combo is swapped; comboKey changes then. */
export type Card = { id: string; combo: MealCombo };

export type Locks = {
  protein?: string;
  carb?: string;
  fat?: string;
  fibers: string[]; // food ids, at most 2
};

export type MealState = {
  mealType: MealType;
  targets: MealTargets;
  cards: Card[];
  /** The combo eaten at this meal (an object, not a key: it survives reroll and swap). */
  picked?: { cardId: string; combo: MealCombo };
  locks: Locks;
  /** comboKeys already shown, without duplicates. */
  seen: string[];
};

export type CompareEntry = { meal: MealType; cardId: string; combo: MealCombo };

/** Everything summarizeDay needs besides the meals. */
export type DayBase = Omit<SummarizeDayInput, 'meals'>;

export type PlanState = {
  fingerprint: string;
  base: DayBase;
  meals: MealState[];
  compare: CompareEntry[];
  day: DayPlan;
  nextCardId: number;
};

export const initialPlanState: PlanState | null = null;

export type PlanAction =
  | { type: 'loaded'; plan: DayPlan; base: DayBase; fingerprint: string }
  | { type: 'pick'; meal: MealType; cardId: string }
  | { type: 'fingerprint'; fingerprint: string };

function recomputeDay(s: Pick<PlanState, 'base' | 'meals'>): DayPlan {
  return summarizeDay({
    ...s.base,
    meals: s.meals.map((m) => ({
      mealType: m.mealType,
      targets: m.targets,
      combos: m.cards.map((c) => c.combo),
      picked: m.picked?.combo,
    })),
  });
}

export function planReducer(
  state: PlanState | null,
  action: PlanAction,
): PlanState | null {
  switch (action.type) {
    case 'loaded': {
      let n = 0;
      const meals: MealState[] = action.plan.meals.map((m) => {
        const cards = m.combos.map((combo) => ({ id: `c${n++}`, combo }));
        return {
          mealType: m.mealType,
          targets: m.targets,
          cards,
          picked: cards[0]
            ? { cardId: cards[0].id, combo: cards[0].combo }
            : undefined,
          locks: { fibers: [] },
          seen: [...new Set(cards.map((c) => c.combo.key))],
        };
      });
      return {
        fingerprint: action.fingerprint,
        base: action.base,
        meals,
        compare: [],
        day: action.plan,
        nextCardId: n,
      };
    }
    case 'pick': {
      if (!state) return state;
      const m = state.meals.find((x) => x.mealType === action.meal);
      const card = m?.cards.find((c) => c.id === action.cardId);
      if (!m || !card) return state;
      const meals = state.meals.map((x) =>
        x === m ? { ...x, picked: { cardId: card.id, combo: card.combo } } : x,
      );
      return {
        ...state,
        meals,
        day: recomputeDay({ base: state.base, meals }),
      };
    }
    case 'fingerprint':
      return state && state.fingerprint === action.fingerprint
        ? state
        : initialPlanState;
  }
}
