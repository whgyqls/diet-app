// Plan screen state as a pure reducer. Plain data only (arrays/Records, no Set/Map).
// Actions: loaded, pick, fingerprint (4a); rerolled, rerollFailed, swapped, toggleLock, compare (4b).
import type {
  DayPlan,
  GenerateFailReason,
  MealCombo,
  MealTargets,
  MealType,
} from '@/types/nutrition';
import {
  COMBOS_PER_MEAL,
  COMPARE_MAX,
  LOCK_MAX_FIBERS,
} from '@/lib/nutrition/constants';
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
  /** Locks before the most recent lock change, to go back to when a reroll with the new lock finds nothing. */
  prevLocks?: Locks;
  /** Fiber foods this meal may hold (a per-meal vegetable count lowers it). */
  maxFibers: number;
  /** comboKeys already shown, without duplicates. */
  seen: string[];
};

export type CompareEntry = { meal: MealType; cardId: string; combo: MealCombo };

/** Everything summarizeDay needs besides the meals. */
export type DayBase = Omit<SummarizeDayInput, 'meals'>;

/** Why the last action was refused or what the user should be told. Plain data; the screen turns it into text. */
export type PlanNoticeCode =
  | 'SLOT_FULL'
  | 'TOO_MANY_FIBERS'
  | 'COMPARE_FULL'
  | 'LOCK_INFEASIBLE'
  | 'EXHAUSTED'
  | 'REROLL_ERROR'
  | 'SWAP_DUPLICATE';
export type PlanNotice = { code: PlanNoticeCode; meal?: MealType };

export type LockSlot = 'protein' | 'carb' | 'fat' | 'fiber';

export type PlanState = {
  fingerprint: string;
  notice: PlanNotice | null;
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
  | { type: 'fingerprint'; fingerprint: string }
  | { type: 'rerolled'; meal: MealType; combos: MealCombo[] }
  | {
      type: 'rerollFailed';
      meal: MealType;
      reason?: GenerateFailReason;
      /** The worker failed (not the engine finding nothing). */
      error?: boolean;
    }
  | { type: 'toggleLock'; meal: MealType; slot: LockSlot; foodId: string }
  | { type: 'swapped'; meal: MealType; cardId: string; combo: MealCombo }
  | { type: 'toggleCompare'; meal: MealType; cardId: string }
  | { type: 'removeCompare'; cardId: string }
  | { type: 'clearCompare' }
  | { type: 'dismissNotice' };

/** What the engine needs to reroll one meal. */
export type RerollRequest = {
  locked: string[];
  /** Every key shown so far, always including the picked combo (the new cards must not repeat it). */
  seen: string[];
  /** New cards wanted: one fewer than a full list when a picked card stays. */
  count: number;
  /** Picked combos of the OTHER meals only. */
  otherPicked: MealCombo[];
};

export function rerollRequestOf(
  state: PlanState,
  meal: MealType,
): RerollRequest {
  const m = state.meals.find((x) => x.mealType === meal);
  if (!m)
    return { locked: [], seen: [], count: COMBOS_PER_MEAL, otherPicked: [] };
  const l = m.locks;
  return {
    locked: [l.protein, l.carb, l.fat, ...l.fibers].filter(
      (x): x is string => x !== undefined,
    ),
    seen: [...new Set([...m.seen, ...(m.picked ? [m.picked.combo.key] : [])])],
    count: COMBOS_PER_MEAL - (m.picked ? 1 : 0),
    otherPicked: state.meals
      .filter((x) => x.mealType !== meal && x.picked)
      .map((x) => x.picked!.combo),
  };
}

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
          maxFibers: LOCK_MAX_FIBERS,
          seen: [...new Set(cards.map((c) => c.combo.key))],
        };
      });
      return {
        fingerprint: action.fingerprint,
        notice: null,
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
    case 'rerolled':
      return state && reroll(state, action.meal, action.combos);
    case 'rerollFailed':
      return (
        state &&
        (action.error
          ? refuse(state, 'REROLL_ERROR', action.meal)
          : rerollFailed(state, action.meal, action.reason))
      );
    case 'toggleLock':
      return state && toggleLock(state, action);
    case 'swapped':
      return state && swap(state, action.meal, action.cardId, action.combo);
    case 'toggleCompare':
      return state && toggleCompare(state, action.meal, action.cardId);
    case 'removeCompare':
      return (
        state && {
          ...state,
          compare: state.compare.filter((c) => c.cardId !== action.cardId),
        }
      );
    case 'clearCompare':
      return state && { ...state, compare: [] };
    case 'dismissNotice':
      return state && state.notice ? { ...state, notice: null } : state;
  }
}

const withMeal = (
  state: PlanState,
  meal: MealType,
  patch: (m: MealState) => MealState,
): PlanState => ({
  ...state,
  meals: state.meals.map((m) => (m.mealType === meal ? patch(m) : m)),
});

const refuse = (
  state: PlanState,
  code: PlanNoticeCode,
  meal?: MealType,
): PlanState => ({ ...state, notice: { code, ...(meal ? { meal } : {}) } });

/** Picked card stays first (same id); new cards follow, never repeating the picked combo or each other. */
function reroll(
  state: PlanState,
  meal: MealType,
  combos: MealCombo[],
): PlanState {
  const m = state.meals.find((x) => x.mealType === meal);
  if (!m) return state;
  const pickedCard = m.picked
    ? (m.cards.find((c) => c.id === m.picked!.cardId) ?? {
        id: m.picked.cardId,
        combo: m.picked.combo,
      })
    : undefined;
  const limit = COMBOS_PER_MEAL - (pickedCard ? 1 : 0);
  const taken = new Set(pickedCard ? [pickedCard.combo.key] : []);
  const fresh: MealCombo[] = [];
  for (const c of combos) {
    if (taken.has(c.key) || fresh.length >= limit) continue;
    taken.add(c.key);
    fresh.push(c);
  }
  if (fresh.length === 0) return refuse(state, 'EXHAUSTED', meal);
  let n = state.nextCardId;
  const cards: Card[] = [
    ...(pickedCard ? [pickedCard] : []),
    ...fresh.map((combo) => ({ id: `c${n++}`, combo })),
  ];
  const next = withMeal(state, meal, (x) => ({
    ...x,
    cards,
    seen: [...new Set([...x.seen, ...cards.map((c) => c.combo.key)])],
  }));
  return {
    ...next,
    nextCardId: n,
    notice: fresh.length < limit ? { code: 'EXHAUSTED', meal } : null,
  };
}

function rerollFailed(
  state: PlanState,
  meal: MealType,
  reason?: GenerateFailReason,
): PlanState {
  const m = state.meals.find((x) => x.mealType === meal);
  if (!m) return state;
  const l = m.locks;
  const locked = l.protein || l.carb || l.fat || l.fibers.length > 0;
  if (locked && reason === 'NO_MATCH')
    return refuse(
      withMeal(state, meal, (x) => ({
        ...x,
        locks: x.prevLocks ?? { fibers: [] },
        prevLocks: undefined,
      })),
      'LOCK_INFEASIBLE',
      meal,
    );
  return refuse(state, 'EXHAUSTED', meal);
}

function toggleLock(
  state: PlanState,
  a: Extract<PlanAction, { type: 'toggleLock' }>,
): PlanState {
  const m = state.meals.find((x) => x.mealType === a.meal);
  if (!m) return state;
  const before = m.locks;
  let locks: Locks;
  if (a.slot === 'fiber') {
    if (before.fibers.includes(a.foodId))
      locks = {
        ...before,
        fibers: before.fibers.filter((f) => f !== a.foodId),
      };
    else if (before.fibers.length >= Math.min(LOCK_MAX_FIBERS, m.maxFibers))
      return refuse(
        state,
        m.maxFibers < LOCK_MAX_FIBERS ? 'TOO_MANY_FIBERS' : 'SLOT_FULL',
        a.meal,
      );
    else locks = { ...before, fibers: [...before.fibers, a.foodId] };
  } else {
    // protein / carb / fat hold one food; another one in the slot replaces it, the same one unlocks.
    locks = { ...before };
    if (before[a.slot] === a.foodId) delete locks[a.slot];
    else locks[a.slot] = a.foodId;
  }
  return {
    ...withMeal(state, a.meal, (x) => ({ ...x, locks, prevLocks: before })),
    notice: null,
  };
}

function swap(
  state: PlanState,
  meal: MealType,
  cardId: string,
  combo: MealCombo,
): PlanState {
  const m = state.meals.find((x) => x.mealType === meal);
  const card = m?.cards.find((c) => c.id === cardId);
  if (!m || !card) return state;
  if (m.cards.some((c) => c.id !== cardId && c.combo.key === combo.key))
    return refuse(state, 'SWAP_DUPLICATE', meal);
  const oldIds = new Set(card.combo.items.map((i) => i.food.id));
  const newIds = new Set(combo.items.map((i) => i.food.id));
  const gone = (id?: string) =>
    id !== undefined && oldIds.has(id) && !newIds.has(id);
  const wasPicked = m.picked?.cardId === cardId;
  const next = withMeal(state, meal, (x) => ({
    ...x,
    cards: x.cards.map((c) => (c.id === cardId ? { id: c.id, combo } : c)),
    picked: wasPicked ? { cardId, combo } : x.picked,
    seen: [...new Set([...x.seen, combo.key])],
    // swapping out a locked food releases its lock
    locks: {
      protein: gone(x.locks.protein) ? undefined : x.locks.protein,
      carb: gone(x.locks.carb) ? undefined : x.locks.carb,
      fat: gone(x.locks.fat) ? undefined : x.locks.fat,
      fibers: x.locks.fibers.filter((f) => !gone(f)),
    },
  }));
  return {
    ...next,
    notice: null,
    compare: state.compare.map((c) =>
      c.cardId === cardId ? { ...c, combo } : c,
    ),
    day: wasPicked
      ? recomputeDay({ base: state.base, meals: next.meals })
      : state.day,
  };
}

function toggleCompare(
  state: PlanState,
  meal: MealType,
  cardId: string,
): PlanState {
  if (state.compare.some((c) => c.cardId === cardId))
    return {
      ...state,
      notice: null,
      compare: state.compare.filter((c) => c.cardId !== cardId),
    };
  const card = state.meals
    .find((m) => m.mealType === meal)
    ?.cards.find((c) => c.id === cardId);
  if (!card) return state;
  if (state.compare.length >= COMPARE_MAX)
    return refuse(state, 'COMPARE_FULL', meal);
  return {
    ...state,
    notice: null,
    compare: [...state.compare, { meal, cardId, combo: card.combo }],
  };
}
