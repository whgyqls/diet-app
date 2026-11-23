// The server version of the saved (★) combos store (table saved_combos). Same SavedStore interface as the
// localStorage one (src/lib/plan/savedCombos.ts).
//
// - Changes are optimistic: list() shows the result at once, the write follows. A failed write is undone by the
//   inverse change (not by restoring an old snapshot, so a later change is not lost) and the call rejects.
// - Calls run one after another in the order they were made.
// - Reads are not trusted: rows go through the validators and bad rows are dropped (mappers.ts).
// - Every query names `user_id`; RLS is the second lock, not the only one.
// - A ★ whose id is not a uuid gets a new uuid (the table's id column is a uuid).
// - The first load starts when the store is created; until it is done status() is 'loading'. The screens wait
//   for 'ready' before they show or change anything (account gate, 5d-3).
import type { SupabaseClient } from '@supabase/supabase-js';
import { KNOWN_IDS } from '@/lib/data/knownIds';
import { isUuid, newUuid } from '@/lib/id/newUuid';
import type {
  SavedCombo,
  SavedStatus,
  SavedStore,
} from '@/lib/plan/savedCombos';
import type { KnownItemIds } from '@/lib/validate/validate';
import { savedRowsToCombos, savedToInsertRow } from './mappers';

const TABLE = 'saved_combos';
const CONFLICT = {
  onConflict: 'user_id,signature',
  ignoreDuplicates: true,
} as const;

const toError = (e: { message?: string } | Error): Error =>
  e instanceof Error
    ? e
    : new Error(e.message ?? 'saved combos request failed');
const withUuid = (s: SavedCombo): SavedCombo =>
  isUuid(s.id) ? s : { ...s, id: newUuid() };
/** Newest first by saved time; equal times keep their order (the stable sort), new items are put first. */
const newestFirst = (list: SavedCombo[]) =>
  [...list].sort((a, b) => b.savedAt - a.savedAt);

export function createSupabaseSavedStore(
  client: SupabaseClient,
  uid: string,
  known: KnownItemIds = KNOWN_IDS,
): SavedStore {
  let items: SavedCombo[] = [];
  let status: SavedStatus = 'loading';
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  const setItems = (next: SavedCombo[]) => {
    items = newestFirst(next);
    emit();
  };

  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job);
    queue = run.catch(() => undefined);
    return run;
  };

  const load = async () => {
    const { data, error } = await client
      .from(TABLE)
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (error) {
      status = 'error';
      emit();
      return;
    }
    items = savedRowsToCombos(data, known);
    status = 'ready';
    emit();
  };

  const store: SavedStore = {
    list: () => items,
    status: () => status,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    // Never rejects: a failure is reported through status() === 'error' (the retry button calls this again).
    refresh() {
      if (status === 'error') {
        status = 'loading';
        emit();
      }
      return enqueue(load).catch(() => {
        status = 'error';
        emit();
      });
    },
    // The part before enqueue() runs at once, so list() is already updated when the promise is returned.
    async toggle(s) {
      const existing = items.filter((x) => x.signature === s.signature);
      if (existing.length > 0) {
        setItems(items.filter((x) => x.signature !== s.signature));
        return enqueue(async () => {
          const { error } = await client
            .from(TABLE)
            .delete()
            .eq('user_id', uid)
            .eq('signature', s.signature);
          if (error) {
            setItems([...existing, ...items]);
            throw toError(error);
          }
          return 'removed' as const;
        });
      }
      const item = withUuid(s);
      setItems([item, ...items]);
      return enqueue(async () => {
        const { error } = await client
          .from(TABLE)
          .upsert(savedToInsertRow(uid, item), CONFLICT);
        if (error) {
          setItems(items.filter((x) => x.id !== item.id));
          throw toError(error);
        }
        return 'added' as const;
      });
    },
    async remove(id) {
      const target = items.filter((x) => x.id === id);
      if (target.length === 0) return;
      setItems(items.filter((x) => x.id !== id));
      return enqueue(async () => {
        const { error } = await client
          .from(TABLE)
          .delete()
          .eq('user_id', uid)
          .eq('id', id);
        if (error) {
          setItems([...target, ...items]);
          throw toError(error);
        }
      });
    },
    async addMany(list) {
      const seen = new Set(items.map((x) => x.signature));
      const fresh: SavedCombo[] = [];
      for (const s of list) {
        if (seen.has(s.signature)) continue;
        seen.add(s.signature);
        fresh.push(withUuid(s));
      }
      if (fresh.length === 0) return [];
      const ids = new Set(fresh.map((x) => x.id));
      setItems([...fresh, ...items]);
      return enqueue(async () => {
        const { error } = await client.from(TABLE).upsert(
          fresh.map((x) => savedToInsertRow(uid, x)),
          CONFLICT,
        );
        if (error) {
          setItems(items.filter((x) => !ids.has(x.id)));
          throw toError(error);
        }
        return fresh.map((x) => x.id);
      });
    },
  };

  void store.refresh(); // the first load
  return store;
}
