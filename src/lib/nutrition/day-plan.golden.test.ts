// Regression guard for generateDayPlan: the whole DayPlan (JSON round trip) must stay identical
// across refactors (e.g. extracting summarizeDay). Regenerate only on purpose:
//   UPDATE_GOLDEN=1 npx vitest run src/lib/nutrition/day-plan.golden.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DayRequest } from './generate';
import { generateDayPlan } from './generate';
import {
  EXAMPLE_PROFILES,
  FOODS,
  REF_YEAR,
  SEASONINGS,
  selectAll,
} from './test-fixtures';
import type { Selection } from '@/types/nutrition';

const GOLDEN_PATH = path.join(
  import.meta.dirname,
  '__fixtures__',
  'day-plan.golden.json',
);

/** A small, fixed subset: first 2 foods of each category + 2 seasonings. */
function partialSelection(): Selection {
  const pick = (cat: string) =>
    FOODS.filter((f) => f.category === cat && f.group !== '기름').slice(0, 2);
  const foods = ['protein', 'carb', 'fiber', 'fat'].flatMap(pick);
  return {
    foods: Object.fromEntries(foods.map((f) => [f.id, 'ok' as const])),
    seasonings: Object.fromEntries(
      SEASONINGS.slice(0, 2).map((s) => [s.id, 'ok' as const]),
    ),
  };
}

type Case = { name: string; req: DayRequest };
const base = { foods: FOODS, seasonings: SEASONINGS, refYear: REF_YEAR };
const [p1, p2, p3] = EXAMPLE_PROFILES.map((e) => e.profile);

const CASES: Case[] = [
  ...EXAMPLE_PROFILES.map((e) => ({
    name: `all selected, ${e.label}`,
    req: { ...base, selection: selectAll(), profile: e.profile },
  })),
  {
    name: 'partial selection, 3 meals',
    req: { ...base, selection: partialSelection(), profile: p1 },
  },
  {
    name: 'partial selection, 2 meals',
    req: {
      ...base,
      selection: partialSelection(),
      profile: { ...p2, mealsPerDay: 2 },
    },
  },
  {
    name: 'styles lowCarb + lowSodium, partial',
    req: {
      ...base,
      selection: partialSelection(),
      profile: p3,
      conditions: { styles: ['lowCarb', 'lowSodium'] },
    },
  },
  {
    name: 'too few foods (no fiber)',
    req: {
      ...base,
      selection: {
        foods: { [FOODS.find((f) => f.category === 'protein')!.id]: 'ok' },
        seasonings: {},
      },
      profile: p1,
    },
  },
];

const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('generateDayPlan golden', () => {
  const actual = () =>
    Object.fromEntries(
      CASES.map((c) => [c.name, roundTrip(generateDayPlan(c.req))]),
    );

  if (process.env.UPDATE_GOLDEN === '1') {
    it('writes the golden file', () => {
      writeFileSync(GOLDEN_PATH, JSON.stringify(actual(), null, 1) + '\n');
    });
    return;
  }

  it('golden file exists', () => {
    expect(existsSync(GOLDEN_PATH)).toBe(true);
  });

  it('matches the stored output for every case (deep equal)', () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
    const now = actual();
    expect(Object.keys(now)).toEqual(Object.keys(golden));
    for (const name of Object.keys(golden)) {
      expect(now[name], name).toEqual(golden[name]);
    }
  });
});
