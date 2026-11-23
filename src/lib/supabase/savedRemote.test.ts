import { describe, expect, it, vi } from 'vitest';
import { isUuid } from '@/lib/id/newUuid';
import type { SavedCombo } from '@/lib/plan/savedCombos';
import { createFakeSupabase, is, type Row } from './__fixtures__/fakeSupabase';
import { savedToInsertRow } from './mappers';
import { createSupabaseSavedStore } from './savedRemote';

const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const combo = (n: number, over: Partial<SavedCombo> = {}): SavedCombo => ({
  id: uuid(n),
  savedAt: Date.parse('2026-11-20T00:00:00.000Z') + n * 1000,
  mealType: 'lunch',
  requestFingerprint: 'fp',
  signature: `sig-${n}`,
  items: [
    { foodId: 'chicken-breast', name: '닭가슴살', grams: 150, basis: 'raw' },
    { foodId: 'white-rice', name: '쌀밥', grams: 200, basis: 'cooked' },
  ],
  oils: [],
  seasonings: [{ id: 'salt', name: '소금', units: 0.5, unitLabel: '작은술' }],
  totals: {
    kcal: 612,
    protein: 45,
    carbs: 60,
    netCarbs: 55,
    fiber: 5,
    fat: 18,
    satFat: 3,
    sodium: 600,
    cholesterol: 90,
  },
  ...over,
});
const rowOf = (c: SavedCombo, uid = UID): Row => savedToInsertRow(uid, c);
/** Lets every pending promise of the store and the fake finish. */
const settle = () => new Promise((r) => setTimeout(r, 0));

async function ready(tables: Record<string, Row[]> = {}) {
  const fake = createFakeSupabase({ uid: UID, tables });
  const store = createSupabaseSavedStore(fake.client, UID);
  await settle();
  return { fake, store };
}

describe('createSupabaseSavedStore: loading and reading', () => {
  it("loads the user's rows newest first, only with a user_id filter, and becomes ready", async () => {
    const fake = createFakeSupabase({
      uid: UID,
      tables: {
        saved_combos: [
          rowOf(combo(1)),
          rowOf(combo(3)),
          rowOf(combo(2)),
          rowOf(combo(9), OTHER),
        ],
      },
    });
    const store = createSupabaseSavedStore(fake.client, UID);
    expect(store.status()).toBe('loading');
    expect(store.list()).toEqual([]);
    await settle();
    expect(store.status()).toBe('ready');
    expect(store.list().map((s) => s.id)).toEqual([uuid(3), uuid(2), uuid(1)]);
    const select = fake.calls.find(is('select', 'saved_combos'))!;
    expect(select.filters).toContainEqual({ col: 'user_id', val: UID });
  });

  it('read validation: rows with unknown foods, broken jsonb or negative numbers are dropped, the rest stay', async () => {
    const good = rowOf(combo(1));
    const { store } = await ready({
      saved_combos: [
        good,
        {
          ...rowOf(combo(2)),
          items: [
            { foodId: 'no-such-food', name: 'x', grams: 1, basis: 'raw' },
          ],
        },
        { ...rowOf(combo(3)), totals: 'broken' },
        {
          ...rowOf(combo(4)),
          items: [
            {
              foodId: 'chicken-breast',
              name: '닭가슴살',
              grams: -5,
              basis: 'raw',
            },
          ],
        },
        { ...rowOf(combo(5)), meal_type: 'snack' },
      ],
    });
    expect(store.status()).toBe('ready');
    expect(store.list().map((s) => s.id)).toEqual([uuid(1)]);
  });

  it('a failed load gives status "error"; refresh retries and recovers', async () => {
    const fake = createFakeSupabase({
      uid: UID,
      tables: { saved_combos: [rowOf(combo(1))] },
    });
    fake.failWhen(is('select', 'saved_combos'));
    const store = createSupabaseSavedStore(fake.client, UID);
    await settle();
    expect(store.status()).toBe('error');
    expect(store.list()).toEqual([]);
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.status()));
    await store.refresh();
    expect(store.status()).toBe('ready');
    expect(seen[0]).toBe('loading');
    expect(store.list()).toHaveLength(1);
  });

  it('refresh never rejects', async () => {
    const { fake, store } = await ready();
    fake.failWhen(is('select', 'saved_combos'));
    await expect(store.refresh()).resolves.toBeUndefined();
    expect(store.status()).toBe('error');
  });
});

describe('createSupabaseSavedStore: toggle', () => {
  it('saves at once (optimistic), then writes one upsert that ignores duplicates', async () => {
    const { fake, store } = await ready();
    const p = store.toggle(combo(1));
    expect(store.list().map((s) => s.id)).toEqual([uuid(1)]); // before the write finished
    await expect(p).resolves.toBe('added');
    const writes = fake.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      kind: 'upsert',
      table: 'saved_combos',
      options: { onConflict: 'user_id,signature', ignoreDuplicates: true },
    });
    expect((writes[0].payload as Row).user_id).toBe(UID);
    expect(fake.tables.saved_combos).toHaveLength(1);
  });

  it('the same signature again removes it, by user_id and signature', async () => {
    const { fake, store } = await ready({ saved_combos: [rowOf(combo(1))] });
    const p = store.toggle(combo(1, { id: uuid(77) })); // another snapshot id, same signature
    expect(store.list()).toEqual([]);
    await expect(p).resolves.toBe('removed');
    const del = fake.writes()[0];
    expect(del.kind).toBe('delete');
    expect(del.filters).toEqual([
      { col: 'user_id', val: UID },
      { col: 'signature', val: 'sig-1' },
    ]);
    expect(fake.tables.saved_combos).toEqual([]);
  });

  it('rollback: a failed save takes the ★ back and rejects', async () => {
    const { fake, store } = await ready({ saved_combos: [rowOf(combo(1))] });
    fake.failWhen(is('upsert', 'saved_combos'));
    const p = store.toggle(combo(2));
    expect(store.list()).toHaveLength(2);
    await expect(p).rejects.toThrow('boom');
    expect(store.list().map((s) => s.id)).toEqual([uuid(1)]);
    expect(fake.tables.saved_combos).toHaveLength(1);
  });

  it('rollback: a failed unstar puts the combo back in its place and rejects', async () => {
    const { fake, store } = await ready({
      saved_combos: [rowOf(combo(1)), rowOf(combo(2)), rowOf(combo(3))],
    });
    fake.failWhen(is('delete', 'saved_combos'));
    const before = store.list().map((s) => s.id);
    const p = store.toggle(combo(2));
    expect(store.list().map((s) => s.id)).toEqual([uuid(3), uuid(1)]);
    await expect(p).rejects.toThrow();
    expect(store.list().map((s) => s.id)).toEqual(before);
  });

  it('a ★ with an old (non-uuid) id gets a uuid, in the list and in the row', async () => {
    const { fake, store } = await ready();
    await store.toggle(combo(1, { id: 'mgx3k2a1b2c3' }));
    const saved = store.list()[0];
    expect(isUuid(saved.id)).toBe(true);
    expect((fake.writes()[0].payload as Row).id).toBe(saved.id);
  });

  it('calls run in order; a failure undoes only its own change', async () => {
    const { fake, store } = await ready();
    fake.failWhen(is('upsert', 'saved_combos')); // only the first upsert fails
    const a = store.toggle(combo(1));
    const b = store.toggle(combo(2));
    expect(store.list()).toHaveLength(2);
    await expect(a).rejects.toThrow();
    await expect(b).resolves.toBe('added');
    expect(store.list().map((s) => s.id)).toEqual([uuid(2)]);
    expect(fake.writes().map((c) => (c.payload as Row).id)).toEqual([
      uuid(1),
      uuid(2),
    ]);
  });

  it('a refresh waits for pending writes, so it does not drop an optimistic ★', async () => {
    const { fake, store } = await ready();
    const release = fake.holdWhen(is('upsert', 'saved_combos'));
    const p = store.toggle(combo(1));
    const r = store.refresh();
    release();
    await p;
    await r;
    expect(store.list().map((s) => s.id)).toEqual([uuid(1)]);
  });
});

describe('createSupabaseSavedStore: duplicates', () => {
  it('a signature already on the server from another device is ignored, not an error', async () => {
    const { fake, store } = await ready();
    fake.tables.saved_combos.push(rowOf(combo(1, { id: uuid(50) }))); // saved elsewhere after our load
    await expect(store.toggle(combo(1))).resolves.toBe('added');
    expect(fake.tables.saved_combos).toHaveLength(1);
    await store.refresh();
    expect(store.list().map((s) => s.id)).toEqual([uuid(50)]); // the server's row wins
  });
});

describe('createSupabaseSavedStore: addMany and remove', () => {
  it('adds only unseen signatures (also inside the list) in one write and returns their ids', async () => {
    const { fake, store } = await ready({ saved_combos: [rowOf(combo(1))] });
    const ids = await store.addMany([
      combo(1, { id: uuid(90) }),
      combo(2),
      combo(2, { id: uuid(91) }),
      combo(3, { id: 'old-style-id' }),
    ]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(uuid(2));
    expect(isUuid(ids[1])).toBe(true);
    const writes = fake.writes();
    expect(writes).toHaveLength(1);
    expect((writes[0].payload as Row[]).map((r) => r.signature)).toEqual([
      'sig-2',
      'sig-3',
    ]);
    expect(store.list()).toHaveLength(3);
  });

  it('nothing new means no write at all', async () => {
    const { fake, store } = await ready({ saved_combos: [rowOf(combo(1))] });
    await expect(store.addMany([combo(1)])).resolves.toEqual([]);
    await expect(store.addMany([])).resolves.toEqual([]);
    expect(fake.writes()).toEqual([]);
  });

  it('rollback: a failed addMany adds none of them and rejects', async () => {
    const { fake, store } = await ready({ saved_combos: [rowOf(combo(1))] });
    fake.failWhen(is('upsert', 'saved_combos'));
    const p = store.addMany([combo(2), combo(3)]);
    expect(store.list()).toHaveLength(3);
    await expect(p).rejects.toThrow();
    expect(store.list().map((s) => s.id)).toEqual([uuid(1)]);
  });

  it('remove deletes by user_id and id; a failure puts it back; an unknown id makes no call', async () => {
    const { fake, store } = await ready({
      saved_combos: [rowOf(combo(1)), rowOf(combo(2))],
    });
    await store.remove(uuid(1));
    expect(fake.writes()[0].filters).toEqual([
      { col: 'user_id', val: UID },
      { col: 'id', val: uuid(1) },
    ]);
    expect(store.list().map((s) => s.id)).toEqual([uuid(2)]);
    fake.failWhen(is('delete', 'saved_combos'));
    await expect(store.remove(uuid(2))).rejects.toThrow();
    expect(store.list().map((s) => s.id)).toEqual([uuid(2)]);
    const writes = fake.writes().length;
    await store.remove('not-there');
    expect(fake.writes()).toHaveLength(writes);
  });
});

describe('createSupabaseSavedStore: subscription', () => {
  it('notifies on load, change and rollback; the list keeps its reference when nothing changes', async () => {
    const fake = createFakeSupabase({ uid: UID });
    const store = createSupabaseSavedStore(fake.client, UID);
    const fn = vi.fn();
    const off = store.subscribe(fn);
    await settle();
    expect(fn).toHaveBeenCalledTimes(1); // loaded
    const a = store.list();
    expect(store.list()).toBe(a);
    fake.failWhen(is('upsert', 'saved_combos'));
    await store.toggle(combo(1)).catch(() => {});
    expect(fn).toHaveBeenCalledTimes(3); // optimistic add + rollback
    off();
    await store.toggle(combo(2));
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
