import { describe, expect, it } from 'vitest';
import { parseProfile, sanitizePartialProfile } from './profile';

const GOOD = {
  sex: 'female',
  birthYear: 1996,
  heightCm: 163,
  weightKg: 60,
  activityLevel: 2,
  goal: 'lose',
  mealsPerDay: 3,
};

describe('sanitizePartialProfile', () => {
  it('keeps a complete valid profile, and it then passes parseProfile', () => {
    expect(sanitizePartialProfile(GOOD)).toEqual(GOOD);
    expect(parseProfile(sanitizePartialProfile(GOOD))).toEqual(GOOD);
  });

  it('drops only the bad fields and keeps the rest', () => {
    const out = sanitizePartialProfile({
      ...GOOD,
      sex: 'x',
      heightCm: 5,
      weightKg: Number.NaN,
      activityLevel: 9,
      mealsPerDay: '3',
    });
    expect(out).toEqual({ birthYear: 1996, goal: 'lose' });
    expect(parseProfile(out)).toBeUndefined();
  });

  it('drops values outside the limits (birth year, height, weight)', () => {
    expect(
      sanitizePartialProfile({ ...GOOD, birthYear: 1800, weightKg: 1000 }),
    ).toEqual({
      sex: 'female',
      heightCm: 163,
      activityLevel: 2,
      goal: 'lose',
      mealsPerDay: 3,
    });
  });

  it('returns {} for anything that is not an object, and ignores unknown keys', () => {
    for (const bad of [null, undefined, 5, 'x', []])
      expect(sanitizePartialProfile(bad)).toEqual({});
    expect(sanitizePartialProfile({ ...GOOD, admin: true })).toEqual(GOOD);
  });
});
