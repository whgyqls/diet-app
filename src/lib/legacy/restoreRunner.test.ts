import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SavedCombo, SavedStore } from '@/lib/plan/savedCombos';
import { RESTORE_WRITE_CHUNK } from '@/lib/supabase/syncConstants';
import { LEGACY_CLAIM_KEY, parseClaim } from './legacyClaim';
import type { RestorePlan } from './planRestore';
import { runRestore, undoRestore, type RestoreDeps } from './restoreRunner';

// ---- fakes ---------------------------------------------------------------------------------------

type Call = { op: string; table?: string; payload?: unknown; extra?: unknown };

function fakeClient(opts: { failOn?: string } = {}) {
  const calls: Call[] = [];
  const result = (op: string, table: string, payload?: unknown) => {
    const fail = opts.failOn === `${table}.${op}`;
    const rows = Array.isArray(payload) ? payload : [];
    const value = {
      data: rows.map((r: { id: string }) => ({ id: r.id })),
      error: fail ? { message: 'boom' } : null,
    };
    // awaitable, and `.select('id')` returns the same
    return Object.assign(Promise.resolve(value), {
      select: () => Promise.resolve(value),
    });
  };
  const client = {
    from: (table: string) => ({
      upsert: (payload: unknown, extra: unknown) => {
        calls.push({ op: 'upsert', table, payload, extra });
        return result('upsert', table, payload);
      },
      delete: () => ({
        eq: () => ({
          in: (_c: string, ids: string[]) => {
            calls.push({ op: 'delete', table, payload: ids });
            return result('delete', table);
          },
        }),
      }),
    }),
    rpc: (name: string, args: unknown) => {
      calls.push({ op: 'rpc', table: name, payload: args });
      return Promise.resolve({
        error: opts.failOn === `${name}.rpc` ? { message: 'boom' } : null,
      });
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function fakeSavedStore(opts: { fail?: boolean } = {}) {
  const added: string[][] = [];
  const store = {
    addMany: async (list: SavedCombo[]) => {
      if (opts.fail) throw new Error('saved boom');
      added.push(list.map((s) => s.id));
      return list.map((s) => s.id);
    },
  } as unknown as SavedStore;
  return { store, added };
}

const memory = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()],
  };
};

const kit = (name: string) => ({
  id: `old-${name}`,
  name,
  selection: { foods: { 'chicken-breast': 'ok' as const }, seasonings: {} },
  createdAt: 1,
  updatedAt: 2,
});
const star = (signature: string): SavedCombo => ({
  id: `old-${signature}`,
  savedAt: 1,
  mealType: 'lunch',
  requestFingerprint: '',
  signature,
  items: [],
  oils: [],
  seasonings: [],
  totals: {} as never,
});

const PLAN: RestorePlan = {
  settings: { profile: { sex: 'male' }, styles: ['lowCarb'], overrides: {} },
  selection: { foods: { tofu: 'ok' }, seasonings: {} },
  kits: [kit('a'), kit('b')],
  saved: [star('x'), star('y')],
  skipped: {
    kitsExisting: 0,
    kitsOverCap: 0,
    savedExisting: 0,
    savedOverCap: 0,
  },
  overwrite: {
    profileFields: 0,
    styles: false,
    overrides: false,
    foods: 0,
    seasonings: 0,
  },
  needsConfirm: false,
  add: { kits: 2, saved: 2 },
  hasChanges: true,
};

function setup(
  over: {
    failOn?: string;
    savedFails?: boolean;
    storage?: Record<string, string>;
  } = {},
) {
  const c = fakeClient({ failOn: over.failOn });
  const s = fakeSavedStore({ fail: over.savedFails });
  const storage = memory(over.storage);
  let n = 0;
  let reloads = 0;
  const deps: RestoreDeps = {
    client: c.client,
    uid: 'me',
    savedStore: s.store,
    storage,
    before: {
      settings: { profile: { sex: 'female' }, styles: [], overrides: {} },
      selection: { foods: { egg: 'ok' }, seasonings: {} },
    },
    reload: async () => void (reloads += 1),
    newId: () => `new-${++n}`,
    now: () => 1234,
  };
  return {
    deps,
    calls: c.calls,
    added: s.added,
    storage,
    reloads: () => reloads,
  };
}

// ---- tests ---------------------------------------------------------------------------------------

describe('runRestore', () => {
  it('writes in order, with the "imported" mark last, new ids, and returns what the undo needs', async () => {
    const t = setup();
    const out = await runRestore(t.deps, PLAN, false);
    expect(out.status).toBe('done');
    const order = t.calls.map((c) => `${c.op}:${c.table}`);
    expect(order).toEqual([
      'upsert:ingredient_kits',
      'rpc:set_food_prefs',
      'upsert:profiles', // settings
      'upsert:profiles', // the mark
    ]);
    const kitsCall = t.calls[0];
    expect((kitsCall.extra as { onConflict: string }).onConflict).toBe(
      'user_id,name',
    );
    expect(
      (kitsCall.extra as { ignoreDuplicates: boolean }).ignoreDuplicates,
    ).toBe(true);
    expect((kitsCall.payload as { id: string }[]).map((r) => r.id)).toEqual([
      'new-1',
      'new-2',
    ]); // not the old ids
    expect(t.added.flat()).toEqual(['new-3', 'new-4']);
    const mark = t.calls[3].payload as {
      id: string;
      legacy_imported_at: string;
    };
    expect(mark.legacy_imported_at).toBe(new Date(1234).toISOString());
    expect(parseClaim(t.storage.getItem(LEGACY_CLAIM_KEY))).toEqual({
      uid: 'me',
      at: 1234,
    });
    expect(t.reloads()).toBe(1);
    if (out.status === 'done') {
      expect(out.undo).toMatchObject({
        kitIds: ['new-1', 'new-2'],
        savedIds: ['new-3', 'new-4'],
        settingsChanged: true,
        selectionChanged: true,
      });
    }
  });

  it('writes in chunks', async () => {
    const t = setup();
    const many = Array.from({ length: RESTORE_WRITE_CHUNK + 5 }, (_, i) =>
      kit(`k${i}`),
    );
    await runRestore(t.deps, { ...PLAN, kits: many, saved: [] }, false);
    const kitCalls = t.calls.filter((c) => c.table === 'ingredient_kits');
    expect(kitCalls.map((c) => (c.payload as unknown[]).length)).toEqual([
      RESTORE_WRITE_CHUNK,
      5,
    ]);
  });

  it('skips the writes the plan does not need (no selection call when the plan leaves it alone)', async () => {
    const t = setup();
    await runRestore(
      t.deps,
      { ...PLAN, selection: null, settings: null, kits: [], saved: [] },
      false,
    );
    expect(t.calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      'upsert:profiles',
    ]); // only the mark
  });

  it('a run that was resumed cannot be undone', async () => {
    const t = setup();
    const out = await runRestore(t.deps, PLAN, true);
    expect(out).toEqual({ status: 'done', undo: null });
  });

  it('stops at the failing step: no mark, the claim stays, the screen is reloaded, and it says it wrote', async () => {
    const t = setup({ savedFails: true });
    const out = await runRestore(t.deps, PLAN, false);
    expect(out.status).toBe('failed');
    if (out.status === 'failed') {
      expect(out.wrote).toBe(true); // the kits were written
      expect(out.message).toContain('saved boom');
    }
    expect(t.calls.some((c) => c.table === 'profiles')).toBe(false); // no settings, no mark
    expect(parseClaim(t.storage.getItem(LEGACY_CLAIM_KEY))?.uid).toBe('me');
    expect(t.reloads()).toBe(1);
  });

  it.each(['ingredient_kits.upsert', 'set_food_prefs.rpc'])(
    '%s failing: the mark is never written',
    async (failOn) => {
      const t = setup({ failOn });
      const out = await runRestore(t.deps, PLAN, false);
      expect(out.status).toBe('failed');
      expect(t.calls.filter((c) => c.table === 'profiles')).toEqual([]);
    },
  );

  it('running it again after a failure finishes the job and gives no undo when told it was resumed', async () => {
    const first = setup({ failOn: 'set_food_prefs.rpc' });
    await runRestore(first.deps, PLAN, false);
    const second = setup({
      storage: { [LEGACY_CLAIM_KEY]: first.storage.getItem(LEGACY_CLAIM_KEY)! },
    });
    const out = await runRestore(second.deps, PLAN, true);
    expect(out).toEqual({ status: 'done', undo: null });
    expect(second.calls.at(-1)?.payload).toMatchObject({
      legacy_imported_at: expect.any(String),
    });
  });

  it("another account's claim: nothing is written", async () => {
    const t = setup({
      storage: {
        [LEGACY_CLAIM_KEY]: JSON.stringify({ uid: 'someone', at: 1 }),
      },
    });
    const out = await runRestore(t.deps, PLAN, false);
    expect(out.status).toBe('failed');
    expect(t.calls).toEqual([]);
    expect(parseClaim(t.storage.getItem(LEGACY_CLAIM_KEY))?.uid).toBe(
      'someone',
    );
  });
});

describe('undoRestore', () => {
  it('clears the mark first, puts the old values back, deletes what was added, removes the claim last', async () => {
    const t = setup();
    const out = await runRestore(t.deps, PLAN, false);
    if (out.status !== 'done' || !out.undo) throw new Error('expected an undo');
    t.calls.length = 0;
    await undoRestore(t.deps, out.undo);
    expect(t.calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      'upsert:profiles', // the mark off
      'upsert:profiles', // old settings
      'rpc:set_food_prefs', // old selection
      'delete:ingredient_kits',
      'delete:saved_combos',
    ]);
    expect(t.calls[0].payload).toEqual({ id: 'me', legacy_imported_at: null });
    expect(t.calls[1].payload).toMatchObject({ sex: 'female', styles: [] });
    expect(t.calls[2].payload).toEqual({
      p_foods: { egg: 'ok' },
      p_seasonings: {},
    });
    expect(t.calls[3].payload).toEqual(['new-1', 'new-2']);
    expect(t.calls[4].payload).toEqual(['new-3', 'new-4']);
    expect(t.storage.getItem(LEGACY_CLAIM_KEY)).toBeNull();
  });

  it('a failing step leaves the claim in place (so the button can still finish a restore)', async () => {
    const t = setup();
    const out = await runRestore(t.deps, PLAN, false);
    if (out.status !== 'done' || !out.undo) throw new Error('expected an undo');
    const failing = setup({
      failOn: 'ingredient_kits.delete',
      storage: { [LEGACY_CLAIM_KEY]: t.storage.getItem(LEGACY_CLAIM_KEY)! },
    });
    await expect(undoRestore(failing.deps, out.undo)).rejects.toThrow('boom');
    expect(failing.storage.getItem(LEGACY_CLAIM_KEY)).not.toBeNull();
  });
});
