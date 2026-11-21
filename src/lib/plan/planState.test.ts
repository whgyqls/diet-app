import { beforeAll, describe, expect, it } from 'vitest';
import type { DayPlan, MealType } from '@/types/nutrition';
import {
  daySetup,
  generateDayPlan,
  type DayRequest,
} from '@/lib/nutrition/generate';
import {
  EXAMPLE_PROFILES,
  FOODS,
  REF_YEAR,
  SEASONINGS,
  selectAll,
} from '@/lib/nutrition/test-fixtures';
import { initialPlanState, planReducer, type PlanState } from './planState';

const req: DayRequest = {
  foods: FOODS,
  seasonings: SEASONINGS,
  selection: selectAll(),
  profile: { ...EXAMPLE_PROFILES[0].profile, mealsPerDay: 2 },
  refYear: REF_YEAR,
};
let plan: DayPlan;
let loaded: PlanState;

const setup = () => {
  const s = daySetup(req);
  return {
    targets: s.targets,
    profile: req.profile,
    settingFlags: s.settingFlags,
    includeFoods: s.includeFoods,
  };
};

beforeAll(() => {
  plan = generateDayPlan(req);
  loaded = planReducer(initialPlanState, {
    type: 'loaded',
    plan,
    base: setup(),
    fingerprint: 'fp1',
  })!;
});

const meal = (s: PlanState, m: MealType) =>
  s.meals.find((x) => x.mealType === m)!;
// 2 meals per day = lunch + dinner
const [FIRST, SECOND] = ['lunch', 'dinner'] as const;

describe('planReducer: loaded', () => {
  it('keeps the meals the plan has (2 meals = 2 entries) with up to 5 cards each', () => {
    expect(loaded.meals.map((m) => m.mealType)).toEqual(
      plan.meals.map((m) => m.mealType),
    );
    for (const m of loaded.meals) expect(m.cards).toHaveLength(5);
  });

  it('picks the first card of every meal; the day equals the plan', () => {
    for (const m of loaded.meals) {
      expect(m.picked?.cardId).toBe(m.cards[0].id);
      expect(m.picked?.combo).toBe(m.cards[0].combo);
    }
    expect(loaded.day.totals).toEqual(plan.totals);
  });

  it('seen holds the keys of all shown cards (no duplicates); locks start empty', () => {
    for (const m of loaded.meals) {
      expect(m.seen).toEqual(m.cards.map((c) => c.combo.key));
      expect(new Set(m.seen).size).toBe(m.seen.length);
      expect(m.locks).toEqual({ fibers: [] });
    }
    expect(loaded.compare).toEqual([]);
  });

  it('card ids are unique across meals', () => {
    const ids = loaded.meals.flatMap((m) => m.cards.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds no Set/Map anywhere (arrays and plain objects only)', () => {
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (v instanceof Set || v instanceof Map || typeof v === 'function')
        bad.push(path);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(loaded, 'state');
    expect(bad).toEqual([]);
  });
});

describe('planReducer: pick', () => {
  it('stores the picked combo object and refreshes the day totals immediately', () => {
    const m = meal(loaded, FIRST);
    const next = planReducer(loaded, {
      type: 'pick',
      meal: FIRST,
      cardId: m.cards[2].id,
    })!;
    expect(meal(next, FIRST).picked).toEqual({
      cardId: m.cards[2].id,
      combo: m.cards[2].combo,
    });
    const expectKcal =
      m.cards[2].combo.totals.kcal +
      meal(loaded, SECOND).cards[0].combo.totals.kcal;
    expect(next.day.totals.kcal).toBeCloseTo(expectKcal, 6);
    // cards and other meals are untouched
    expect(meal(next, FIRST).cards).toBe(m.cards);
    expect(meal(next, SECOND)).toBe(meal(loaded, SECOND));
  });

  it('ignores an unknown card id and a meal that is not in the plan', () => {
    expect(
      planReducer(loaded, { type: 'pick', meal: FIRST, cardId: 'nope' }),
    ).toBe(loaded);
    expect(
      planReducer(loaded, {
        type: 'pick',
        meal: 'breakfast',
        cardId: loaded.meals[0].cards[0].id,
      }),
    ).toBe(loaded);
  });
});

describe('planReducer: fingerprint', () => {
  it('same fingerprint keeps the state; a different one resets it', () => {
    expect(
      planReducer(loaded, { type: 'fingerprint', fingerprint: 'fp1' }),
    ).toBe(loaded);
    expect(
      planReducer(loaded, { type: 'fingerprint', fingerprint: 'fp2' }),
    ).toBe(initialPlanState);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 4b: reroll, swap, lock, compare
// ---------------------------------------------------------------------------------------------
import { COMBOS_PER_MEAL, COMPARE_MAX } from '@/lib/nutrition/constants';
import { generateMealOptions } from '@/lib/nutrition/mealOptions';
import { rerollRequestOf } from './planState';
import type { MealCombo } from '@/types/nutrition';

const fresh = (
  m: PlanState['meals'][number],
  n: number,
  seen: string[] = m.seen,
) =>
  generateMealOptions({
    foods: FOODS,
    seasonings: SEASONINGS,
    selection: selectAll(),
    targets: m.targets,
    seen,
    count: n,
  }).combos;

describe('rerollRequestOf', () => {
  it('always puts the picked combo key in seen and asks for one card fewer', () => {
    const m = meal(loaded, FIRST);
    // even if the picked key somehow was not in seen
    const odd: PlanState = {
      ...loaded,
      meals: loaded.meals.map((x) => (x === m ? { ...x, seen: [] } : x)),
    };
    const r = rerollRequestOf(odd, FIRST);
    expect(r.seen).toContain(m.picked!.combo.key);
    expect(r.count).toBe(COMBOS_PER_MEAL - 1);
  });

  it('otherPicked holds only the OTHER meals picked combos, never the meal being rerolled', () => {
    const a = meal(loaded, FIRST);
    const b = meal(loaded, SECOND);
    const r1 = rerollRequestOf(loaded, FIRST);
    expect(r1.otherPicked).toEqual([b.picked!.combo]);
    expect(r1.otherPicked).not.toContain(a.picked!.combo);
    const r2 = rerollRequestOf(loaded, SECOND);
    expect(r2.otherPicked).toEqual([a.picked!.combo]);
  });

  it('uses the picked combo of other meals, not their first card, after a pick', () => {
    const b = meal(loaded, SECOND);
    const next = planReducer(loaded, {
      type: 'pick',
      meal: SECOND,
      cardId: b.cards[3].id,
    })!;
    expect(rerollRequestOf(next, FIRST).otherPicked).toEqual([
      b.cards[3].combo,
    ]);
  });

  it('flattens the locked foods of that meal', () => {
    let s = planReducer(loaded, {
      type: 'toggleLock',
      meal: FIRST,
      slot: 'protein',
      foodId: 'chicken-breast',
    })!;
    s = planReducer(s, {
      type: 'toggleLock',
      meal: FIRST,
      slot: 'fiber',
      foodId: 'cabbage',
    })!;
    expect(rerollRequestOf(s, FIRST).locked.sort()).toEqual([
      'cabbage',
      'chicken-breast',
    ]);
    expect(rerollRequestOf(s, SECOND).locked).toEqual([]);
  });
});

describe('planReducer: rerolled', () => {
  const rerolled = (
    s: PlanState,
    m: typeof FIRST | typeof SECOND,
    combos?: MealCombo[],
  ) => {
    const req = rerollRequestOf(s, m);
    const ms = meal(s, m);
    return planReducer(s, {
      type: 'rerolled',
      meal: m,
      combos: combos ?? fresh(ms, req.count, req.seen),
    })!;
  };

  it('keeps the picked card first (same card id), followed by up to 4 new cards', () => {
    const before = meal(loaded, FIRST);
    const next = rerolled(loaded, FIRST);
    const m = meal(next, FIRST);
    expect(m.cards).toHaveLength(5);
    expect(m.cards[0]).toBe(
      before.picked && before.cards.find((c) => c.id === before.picked!.cardId),
    );
    expect(m.picked).toBe(before.picked);
    const oldKeys = before.cards.map((c) => c.combo.key);
    for (const c of m.cards.slice(1))
      expect(oldKeys).not.toContain(c.combo.key);
  });

  it('keeps the day unchanged (the picked combo did not change)', () => {
    const next = rerolled(loaded, FIRST);
    expect(next.day).toBe(loaded.day);
  });

  it('when a non-first card was picked, that card stays and is moved to the front', () => {
    const b = meal(loaded, FIRST);
    const s = planReducer(loaded, {
      type: 'pick',
      meal: FIRST,
      cardId: b.cards[3].id,
    })!;
    const next = rerolled(s, FIRST);
    expect(meal(next, FIRST).cards[0].id).toBe(b.cards[3].id);
    expect(meal(next, FIRST).picked?.cardId).toBe(b.cards[3].id);
    expect(next.day.totals).toEqual(s.day.totals);
  });

  it('never lets a new card duplicate the picked combo, even if the engine returned it', () => {
    const m = meal(loaded, FIRST);
    const dup = m.picked!.combo;
    const next = rerolled(loaded, FIRST, [dup, ...fresh(m, 4)]);
    const keys = meal(next, FIRST).cards.map((c) => c.combo.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k === dup.key)).toHaveLength(1);
  });

  it('adds the new keys to seen without duplicates, and seen keeps the picked key', () => {
    const next = rerolled(loaded, FIRST);
    const m = meal(next, FIRST);
    expect(new Set(m.seen).size).toBe(m.seen.length);
    for (const c of m.cards) expect(m.seen).toContain(c.combo.key);
    expect(m.seen).toContain(m.picked!.combo.key);
    expect(m.seen.length).toBeGreaterThan(meal(loaded, FIRST).seen.length);
  });

  it('a second reroll never repeats anything seen before', () => {
    const one = rerolled(loaded, FIRST);
    const seenBefore = [...meal(one, FIRST).seen];
    const two = rerolled(one, FIRST);
    const newKeys = meal(two, FIRST)
      .cards.slice(1)
      .map((c) => c.combo.key);
    for (const k of newKeys) expect(seenBefore).not.toContain(k);
  });

  it('does not touch the other meal, its cards or its picked combo', () => {
    const next = rerolled(loaded, FIRST);
    expect(meal(next, SECOND)).toBe(meal(loaded, SECOND));
  });

  it('with no new combos the cards stay as they were and a notice says so', () => {
    const next = planReducer(loaded, {
      type: 'rerolled',
      meal: FIRST,
      combos: [],
    })!;
    expect(meal(next, FIRST).cards).toBe(meal(loaded, FIRST).cards);
    expect(next.notice).toEqual({ code: 'EXHAUSTED', meal: FIRST });
  });

  it('keeps compare entries (snapshots) when their cards leave the list', () => {
    const m = meal(loaded, FIRST);
    const target = m.cards[2]; // not the picked one: it will be gone after the reroll
    const s = planReducer(loaded, {
      type: 'toggleCompare',
      meal: FIRST,
      cardId: target.id,
    })!;
    const next = rerolled(s, FIRST);
    expect(meal(next, FIRST).cards.map((c) => c.id)).not.toContain(target.id);
    expect(next.compare).toEqual([
      { meal: FIRST, cardId: target.id, combo: target.combo },
    ]);
  });

  it('keeps locks through a reroll', () => {
    const s = planReducer(loaded, {
      type: 'toggleLock',
      meal: FIRST,
      slot: 'fiber',
      foodId: 'cabbage',
    })!;
    const next = rerolled(s, FIRST, []);
    expect(meal(next, FIRST).locks.fibers).toEqual(['cabbage']);
  });
});

describe('planReducer: rerollFailed (lock cannot form a combo)', () => {
  it('reverts the last lock change and tells the user', () => {
    let s = planReducer(loaded, {
      type: 'toggleLock',
      meal: FIRST,
      slot: 'protein',
      foodId: 'chicken-breast',
    })!;
    s = planReducer(s, {
      type: 'toggleLock',
      meal: FIRST,
      slot: 'carb',
      foodId: 'white-rice',
    })!;
    const next = planReducer(s, {
      type: 'rerollFailed',
      meal: FIRST,
      reason: 'NO_MATCH',
    })!;
    expect(meal(next, FIRST).locks).toEqual({
      protein: 'chicken-breast',
      fibers: [],
    });
    expect(next.notice).toEqual({ code: 'LOCK_INFEASIBLE', meal: FIRST });
    expect(meal(next, FIRST).cards).toBe(meal(loaded, FIRST).cards);
  });

  it('with no locks it only reports the failure', () => {
    const next = planReducer(loaded, {
      type: 'rerollFailed',
      meal: FIRST,
      reason: 'NO_MATCH',
    })!;
    expect(meal(next, FIRST).locks).toEqual({ fibers: [] });
    expect(next.notice).toEqual({ code: 'EXHAUSTED', meal: FIRST });
  });
});

describe('planReducer: toggleLock slot rules', () => {
  const lock = (
    s: PlanState,
    slot: 'protein' | 'carb' | 'fat' | 'fiber',
    foodId: string,
  ) => planReducer(s, { type: 'toggleLock', meal: FIRST, slot, foodId })!;

  it('protein, carb and fat hold one food each; locking another in the same slot replaces it', () => {
    let s = lock(loaded, 'protein', 'chicken-breast');
    s = lock(s, 'protein', 'beef-eye-round');
    s = lock(s, 'carb', 'white-rice');
    s = lock(s, 'fat', 'almond');
    expect(meal(s, FIRST).locks).toEqual({
      protein: 'beef-eye-round',
      carb: 'white-rice',
      fat: 'almond',
      fibers: [],
    });
  });

  it('toggling a locked food unlocks it', () => {
    let s = lock(loaded, 'protein', 'chicken-breast');
    s = lock(s, 'protein', 'chicken-breast');
    expect(meal(s, FIRST).locks).toEqual({ fibers: [] });
    s = lock(s, 'fiber', 'cabbage');
    s = lock(s, 'fiber', 'cabbage');
    expect(meal(s, FIRST).locks.fibers).toEqual([]);
  });

  it('allows 2 fibers and rejects the 3rd (state unchanged, SLOT_FULL)', () => {
    let s = lock(loaded, 'fiber', 'cabbage');
    s = lock(s, 'fiber', 'lettuce');
    const rejected = lock(s, 'fiber', 'perilla-leaf');
    expect(meal(rejected, FIRST).locks.fibers).toEqual(['cabbage', 'lettuce']);
    expect(rejected.notice).toEqual({ code: 'SLOT_FULL', meal: FIRST });
    expect(rejected.meals).toBe(s.meals);
  });

  it('rejects more fibers than the meal allows (TOO_MANY_FIBERS)', () => {
    const one: PlanState = {
      ...loaded,
      meals: loaded.meals.map((m) =>
        m.mealType === FIRST ? { ...m, maxFibers: 1 } : m,
      ),
    };
    const s = lock(one, 'fiber', 'cabbage');
    const rejected = lock(s, 'fiber', 'lettuce');
    expect(meal(rejected, FIRST).locks.fibers).toEqual(['cabbage']);
    expect(rejected.notice).toEqual({ code: 'TOO_MANY_FIBERS', meal: FIRST });
  });

  it('locks of one meal do not affect the other meal', () => {
    const s = lock(loaded, 'protein', 'chicken-breast');
    expect(meal(s, SECOND).locks).toEqual({ fibers: [] });
  });

  it('a successful change clears an old notice', () => {
    let s = lock(loaded, 'fiber', 'cabbage');
    s = lock(s, 'fiber', 'lettuce');
    s = lock(s, 'fiber', 'perilla-leaf'); // rejected -> notice
    expect(s.notice).not.toBeNull();
    s = lock(s, 'protein', 'chicken-breast');
    expect(s.notice).toBeNull();
  });
});

describe('planReducer: swapped', () => {
  const swapOnce = (s: PlanState, cardIdx: number) => {
    const m = meal(s, FIRST);
    const card = m.cards[cardIdx];
    const protein = card.combo.items.find(
      (i) => i.food.category === 'protein',
    )!.food;
    const other = fresh(m, 40, []).find(
      (c) =>
        c.key !== card.combo.key &&
        !m.cards.some((x) => x.combo.key === c.key) &&
        c.items.some(
          (i) => i.food.category === 'protein' && i.food.id !== protein.id,
        ),
    )!;
    return {
      card,
      other,
      next: planReducer(s, {
        type: 'swapped',
        meal: FIRST,
        cardId: card.id,
        combo: other,
      })!,
    };
  };

  it('replaces the combo of the same card id (the key changes), at the same position', () => {
    const { card, other, next } = swapOnce(loaded, 2);
    const m = meal(next, FIRST);
    expect(m.cards[2]).toEqual({ id: card.id, combo: other });
    expect(m.cards.map((c) => c.id)).toEqual(
      meal(loaded, FIRST).cards.map((c) => c.id),
    );
    expect(m.seen).toContain(other.key);
  });

  it('on the picked card: picked becomes the new combo and the day totals follow', () => {
    const { other, next } = swapOnce(loaded, 0);
    const m = meal(next, FIRST);
    expect(m.picked).toEqual({ cardId: m.cards[0].id, combo: other });
    const expectKcal =
      other.totals.kcal + meal(loaded, SECOND).picked!.combo.totals.kcal;
    expect(next.day.totals.kcal).toBeCloseTo(expectKcal, 6);
  });

  it('on a not-picked card: picked and the day do not change', () => {
    const { next } = swapOnce(loaded, 3);
    expect(meal(next, FIRST).picked).toBe(meal(loaded, FIRST).picked);
    expect(next.day).toBe(loaded.day);
  });

  it('updates a compare entry of that card to the new combo', () => {
    const m = meal(loaded, FIRST);
    const s = planReducer(loaded, {
      type: 'toggleCompare',
      meal: FIRST,
      cardId: m.cards[2].id,
    })!;
    const { other, next } = swapOnce(s, 2);
    expect(next.compare).toEqual([
      { meal: FIRST, cardId: m.cards[2].id, combo: other },
    ]);
  });

  it('releases the lock of the food that was swapped out', () => {
    const m = meal(loaded, FIRST);
    const card = m.cards[2];
    const old = card.combo.items.find((i) => i.food.category === 'protein')!
      .food.id;
    const s = planReducer(loaded, {
      type: 'toggleLock',
      meal: FIRST,
      slot: 'protein',
      foodId: old,
    })!;
    const { next } = swapOnce(s, 2);
    expect(meal(next, FIRST).locks.protein).toBeUndefined();
  });

  it('rejects a swap that would duplicate another card (SWAP_DUPLICATE)', () => {
    const m = meal(loaded, FIRST);
    const next = planReducer(loaded, {
      type: 'swapped',
      meal: FIRST,
      cardId: m.cards[1].id,
      combo: m.cards[2].combo,
    })!;
    expect(meal(next, FIRST).cards).toBe(m.cards);
    expect(next.notice).toEqual({ code: 'SWAP_DUPLICATE', meal: FIRST });
  });

  it('ignores an unknown card', () => {
    const m = meal(loaded, FIRST);
    const next = planReducer(loaded, {
      type: 'swapped',
      meal: FIRST,
      cardId: 'nope',
      combo: m.cards[0].combo,
    })!;
    expect(next.meals).toBe(loaded.meals);
  });
});

describe('planReducer: compare', () => {
  const toggle = (s: PlanState, m: typeof FIRST | typeof SECOND, i: number) =>
    planReducer(s, {
      type: 'toggleCompare',
      meal: m,
      cardId: meal(s, m).cards[i].id,
    })!;

  it('adds, removes by toggling, and holds snapshots of the combos', () => {
    let s = toggle(loaded, FIRST, 1);
    expect(s.compare).toHaveLength(1);
    expect(s.compare[0].combo).toBe(meal(loaded, FIRST).cards[1].combo);
    s = toggle(s, FIRST, 1);
    expect(s.compare).toEqual([]);
  });

  it(`holds at most ${COMPARE_MAX}; the next one is rejected with COMPARE_FULL`, () => {
    let s = toggle(loaded, FIRST, 0);
    s = toggle(s, FIRST, 1);
    s = toggle(s, SECOND, 0);
    expect(s.compare).toHaveLength(COMPARE_MAX);
    const rejected = toggle(s, SECOND, 1);
    expect(rejected.compare).toBe(s.compare);
    expect(rejected.notice).toEqual({ code: 'COMPARE_FULL', meal: SECOND });
    // removing one makes room again
    const room = toggle(s, FIRST, 0);
    expect(toggle(room, SECOND, 1).compare).toHaveLength(COMPARE_MAX);
  });

  it('compares combos of different meals', () => {
    const s = toggle(toggle(loaded, FIRST, 0), SECOND, 0);
    expect(s.compare.map((c) => c.meal)).toEqual([FIRST, SECOND]);
  });

  it('removeCompare drops one entry by card id, also for cards that left the list', () => {
    const s = toggle(toggle(loaded, FIRST, 0), FIRST, 1);
    const id = s.compare[0].cardId;
    expect(
      planReducer(s, { type: 'removeCompare', cardId: id })!.compare.map(
        (c) => c.cardId,
      ),
    ).toEqual([s.compare[1].cardId]);
    expect(planReducer(s, { type: 'clearCompare' })!.compare).toEqual([]);
  });
});

describe('planReducer: dismissNotice', () => {
  it('clears the notice', () => {
    const s = planReducer(loaded, {
      type: 'rerolled',
      meal: FIRST,
      combos: [],
    })!;
    expect(s.notice).not.toBeNull();
    expect(planReducer(s, { type: 'dismissNotice' })!.notice).toBeNull();
  });
});

describe('planReducer: 4b state stays plain data', () => {
  it('has no Set/Map after reroll, lock, swap and compare', () => {
    let s = planReducer(loaded, {
      type: 'toggleLock',
      meal: FIRST,
      slot: 'fiber',
      foodId: 'cabbage',
    })!;
    s = planReducer(s, {
      type: 'toggleCompare',
      meal: FIRST,
      cardId: meal(s, FIRST).cards[1].id,
    })!;
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (v instanceof Set || v instanceof Map) bad.push(path);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(s, 'state');
    expect(bad).toEqual([]);
  });
});

describe('planReducer: rerollFailed by a worker error', () => {
  it('says so (REROLL_ERROR) and leaves cards and locks alone', () => {
    const s = planReducer(loaded, {
      type: 'toggleLock',
      meal: FIRST,
      slot: 'protein',
      foodId: 'chicken-breast',
    })!;
    const next = planReducer(s, {
      type: 'rerollFailed',
      meal: FIRST,
      error: true,
    })!;
    expect(next.notice).toEqual({ code: 'REROLL_ERROR', meal: FIRST });
    expect(meal(next, FIRST).locks).toEqual({
      protein: 'chicken-breast',
      fibers: [],
    });
    expect(meal(next, FIRST).cards).toBe(meal(loaded, FIRST).cards);
  });
});
