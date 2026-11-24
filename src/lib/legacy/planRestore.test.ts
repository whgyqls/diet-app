import { describe, expect, it } from 'vitest';
import type { IngredientKit } from '@/lib/kits/kits';
import type { SavedCombo } from '@/lib/plan/savedCombos';
import {
  RESTORE_MAX_KITS,
  RESTORE_MAX_SAVED,
} from '@/lib/supabase/syncConstants';
import { planRestore, type AccountData } from './planRestore';
import type { LegacyRecord } from './readLegacy';

const emptyLegacy = (): LegacyRecord => ({
  profile: {},
  styles: [],
  overrides: {},
  selection: { foods: {}, seasonings: {} },
  kits: [],
  saved: [],
  dropped: { kits: 0, saved: 0 },
  signaturesCorrected: 0,
});
const emptyAccount = (): AccountData => ({
  profile: {},
  styles: [],
  overrides: {},
  selection: { foods: {}, seasonings: {} },
  kits: [],
  savedSignatures: new Set(),
});
const kit = (name: string, updatedAt = 1): IngredientKit => ({
  id: `k-${name}`,
  name,
  selection: { foods: { 'chicken-breast': 'ok' }, seasonings: {} },
  createdAt: 1,
  updatedAt,
});
const star = (signature: string, savedAt = 1): SavedCombo => ({
  id: `s-${signature}`,
  savedAt,
  mealType: 'lunch',
  requestFingerprint: '',
  signature,
  items: [],
  oils: [],
  seasonings: [],
  totals: {} as never,
});

describe('planRestore: an empty account (the usual case)', () => {
  it('takes everything and asks nothing', () => {
    const legacy: LegacyRecord = {
      ...emptyLegacy(),
      profile: { sex: 'male', birthYear: 1990 },
      styles: ['lowCarb'],
      overrides: { sodiumMax: 1500 },
      selection: {
        foods: { 'chicken-breast': 'ok' },
        seasonings: { salt: 'ok' },
      },
      kits: [kit('a')],
      saved: [star('x')],
    };
    const p = planRestore(legacy, emptyAccount());
    expect(p.needsConfirm).toBe(false);
    expect(p.settings).toEqual({
      profile: { sex: 'male', birthYear: 1990 },
      styles: ['lowCarb'],
      overrides: { sodiumMax: 1500 },
    });
    expect(p.selection).toEqual(legacy.selection);
    expect(p.add).toEqual({ kits: 1, saved: 1 });
    expect(p.hasChanges).toBe(true);
  });

  it('an empty record changes nothing', () => {
    const p = planRestore(emptyLegacy(), emptyAccount());
    expect(p.hasChanges).toBe(false);
    expect(p.settings).toBeNull();
    expect(p.selection).toBeNull();
  });
});

describe('planRestore: only parts where the record has a value change anything', () => {
  const account = (): AccountData => ({
    ...emptyAccount(),
    profile: { sex: 'female', birthYear: 1985, heightCm: 160 },
    styles: ['lowSodium'],
    overrides: { sodiumMax: 1800 },
    selection: { foods: { tofu: 'ok' }, seasonings: { salt: 'ok' } },
  });

  it('an empty selection in the record leaves the account selection alone (no write at all)', () => {
    const p = planRestore(
      { ...emptyLegacy(), profile: { weightKg: 60 } },
      account(),
    );
    expect(p.selection).toBeNull();
    expect(p.overwrite.foods).toBe(0);
    expect(p.overwrite.seasonings).toBe(0);
    expect(p.needsConfirm).toBe(false); // weight was empty in the account: a fill, not an overwrite
    expect(p.settings?.profile).toEqual({
      sex: 'female',
      birthYear: 1985,
      heightCm: 160,
      weightKg: 60,
    });
  });

  it('foods and seasonings are judged separately: only the side that has values is replaced', () => {
    const p = planRestore(
      {
        ...emptyLegacy(),
        selection: { foods: { 'chicken-breast': 'ok' }, seasonings: {} },
      },
      account(),
    );
    expect(p.selection).toEqual({
      foods: { 'chicken-breast': 'ok' },
      seasonings: { salt: 'ok' }, // the account's seasonings are passed through
    });
    expect(p.overwrite).toMatchObject({ foods: 1, seasonings: 0 });
    expect(p.needsConfirm).toBe(true);
  });

  it('profile: a differing field overwrites (counted), a missing one stays, an equal one is no change', () => {
    const p = planRestore(
      { ...emptyLegacy(), profile: { sex: 'male', birthYear: 1985 } },
      account(),
    );
    expect(p.settings?.profile).toEqual({
      sex: 'male',
      birthYear: 1985,
      heightCm: 160,
    });
    expect(p.overwrite.profileFields).toBe(1); // sex only
    const same = planRestore(
      { ...emptyLegacy(), profile: { sex: 'female' } },
      account(),
    );
    expect(same.settings).toBeNull();
    expect(same.hasChanges).toBe(false);
  });

  it('styles and goal overrides: replaced when the record has some, kept when it has none', () => {
    const kept = planRestore(emptyLegacy(), account());
    expect(kept.settings).toBeNull();
    const replaced = planRestore(
      {
        ...emptyLegacy(),
        styles: ['lowCarb'],
        overrides: { sodiumMax: 1500 },
      },
      account(),
    );
    expect(replaced.settings).toMatchObject({
      styles: ['lowCarb'],
      overrides: { sodiumMax: 1500 },
    });
    expect(replaced.overwrite).toMatchObject({ styles: true, overrides: true });
  });

  it('the same values as the account: no overwrite, no confirm', () => {
    const a = account();
    const p = planRestore(
      {
        ...emptyLegacy(),
        styles: [...a.styles],
        overrides: { ...a.overrides },
        selection: {
          foods: { ...a.selection.foods },
          seasonings: { ...a.selection.seasonings },
        },
      },
      a,
    );
    expect(p.hasChanges).toBe(false);
    expect(p.needsConfirm).toBe(false);
  });
});

describe('planRestore: kits', () => {
  it('an existing name keeps the account kit; the skipped ones are counted', () => {
    const acct = { ...emptyAccount(), kits: [kit('a')] };
    const p = planRestore(
      { ...emptyLegacy(), kits: [kit('a'), kit('b')] },
      acct,
    );
    expect(p.kits.map((k) => k.name)).toEqual(['b']);
    expect(p.skipped.kitsExisting).toBe(1);
  });

  it('stops at the cap for the merged result, newest first, and counts the rest', () => {
    const legacyKits = Array.from({ length: 35 }, (_, i) => kit(`k${i}`, i));
    const p = planRestore(
      { ...emptyLegacy(), kits: legacyKits },
      emptyAccount(),
    );
    expect(p.kits).toHaveLength(RESTORE_MAX_KITS);
    expect(p.kits[0].name).toBe('k34'); // newest
    expect(p.skipped.kitsOverCap).toBe(5);
    const full = planRestore(
      { ...emptyLegacy(), kits: [kit('new')] },
      {
        ...emptyAccount(),
        kits: Array.from({ length: RESTORE_MAX_KITS }, (_, i) =>
          kit(`own${i}`),
        ),
      },
    );
    expect(full.kits).toEqual([]);
    expect(full.skipped.kitsOverCap).toBe(1);
  });
});

describe('planRestore: ★', () => {
  it('skips signatures the account has and duplicates inside the record (the newest of those is kept)', () => {
    const p = planRestore(
      {
        ...emptyLegacy(),
        saved: [star('a', 1), star('a', 9), star('b', 2), star('c', 3)],
      },
      { ...emptyAccount(), savedSignatures: new Set(['c']) },
    );
    expect(p.saved.map((s) => s.signature).sort()).toEqual(['a', 'b']);
    expect(p.saved.find((s) => s.signature === 'a')?.savedAt).toBe(9);
    expect(p.skipped.savedExisting).toBe(2);
  });

  it('stops at the cap, newest first', () => {
    const many = Array.from({ length: RESTORE_MAX_SAVED + 10 }, (_, i) =>
      star(`s${i}`, i),
    );
    const p = planRestore({ ...emptyLegacy(), saved: many }, emptyAccount());
    expect(p.saved).toHaveLength(RESTORE_MAX_SAVED);
    expect(p.saved[0].signature).toBe(`s${RESTORE_MAX_SAVED + 9}`);
    expect(p.skipped.savedOverCap).toBe(10);
  });

  it('the account already at the cap: none added', () => {
    const p = planRestore(
      { ...emptyLegacy(), saved: [star('new')] },
      {
        ...emptyAccount(),
        savedSignatures: new Set(
          Array.from({ length: RESTORE_MAX_SAVED }, (_, i) => `own${i}`),
        ),
      },
    );
    expect(p.saved).toEqual([]);
    expect(p.skipped.savedOverCap).toBe(1);
  });
});
