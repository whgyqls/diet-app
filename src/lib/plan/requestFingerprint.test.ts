import { describe, expect, it } from 'vitest';
import { requestFingerprint, type PlanInputs } from './requestFingerprint';

const inputs: PlanInputs = {
  profile: {
    sex: 'female',
    birthYear: 1996,
    heightCm: 163,
    weightKg: 60,
    activityLevel: 2,
    goal: 'lose',
    mealsPerDay: 3,
  },
  styles: ['lowCarb', 'lowSodium'],
  overrides: { sodiumMax: 1800 },
  selection: {
    foods: { b: 'ok', a: 'favorite' },
    seasonings: { z: 'ok' },
  },
};

describe('requestFingerprint', () => {
  it('is the same for the same inputs regardless of key or style order', () => {
    const shuffled: PlanInputs = {
      ...inputs,
      styles: ['lowSodium', 'lowCarb'],
      selection: { foods: { a: 'favorite', b: 'ok' }, seasonings: { z: 'ok' } },
    };
    expect(requestFingerprint(shuffled)).toBe(requestFingerprint(inputs));
  });

  it.each([
    ['profile', { ...inputs, profile: { ...inputs.profile, weightKg: 61 } }],
    ['styles', { ...inputs, styles: ['lowCarb' as const] }],
    ['overrides', { ...inputs, overrides: { sodiumMax: 1700 } }],
    [
      'food preference',
      {
        ...inputs,
        selection: {
          ...inputs.selection,
          foods: { a: 'ok' as const, b: 'ok' as const },
        },
      },
    ],
    [
      'seasoning selection',
      { ...inputs, selection: { ...inputs.selection, seasonings: {} } },
    ],
  ])('changes when %s changes', (_n, changed) => {
    expect(requestFingerprint(changed as PlanInputs)).not.toBe(
      requestFingerprint(inputs),
    );
  });
});
