// Writes the plan of "이전 기록 불러오기" to the server and takes it back (PLAN.md 9.2). Not React.
//
// Order: claim -> kits -> ★ -> selection -> settings -> "imported" mark (LAST) -> reload.
// Every step can run again with the same result: the selection and the settings are replaced as a whole, and
// kits / ★ are inserted with "ignore duplicates" on their unique keys ((user_id, name), (user_id, signature)).
// The mark comes last, so a restore that stopped half way leaves the button visible and pressing it again
// finishes the job without duplicates.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IngredientKit } from '@/lib/kits/kits';
import type { SavedStore } from '@/lib/plan/savedCombos';
import {
  kitToInsertRow,
  selectionToRpcArgs,
  settingsToProfileRow,
} from '@/lib/supabase/mappers';
import { RESTORE_WRITE_CHUNK } from '@/lib/supabase/syncConstants';
import type { Selection } from '@/types/nutrition';
import {
  LEGACY_CLAIM_KEY,
  claimOwner,
  parseClaim,
  serializeClaim,
} from './legacyClaim';
import type { RestorePlan } from './planRestore';

type KeyValueStorage = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
};

/** The account's settings and selection as they were before the restore (the undo puts these back). */
export type AccountSnapshot = {
  settings: NonNullable<RestorePlan['settings']>;
  selection: Selection;
};

export type RestoreDeps = {
  client: SupabaseClient;
  uid: string;
  savedStore: SavedStore;
  storage: KeyValueStorage;
  /** The account before the restore. */
  before: AccountSnapshot;
  /** Loads the account values and the ★ from the server again (the screen then shows the result). */
  reload: () => Promise<void>;
  newId: () => string;
  now?: () => number;
};

export type UndoInfo = {
  before: AccountSnapshot;
  settingsChanged: boolean;
  selectionChanged: boolean;
  kitIds: string[];
  savedIds: string[];
};

export type RestoreOutcome =
  | { status: 'done'; undo: UndoInfo | null }
  | { status: 'failed'; message: string; wrote: boolean };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const chunks = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const must = (what: string, r: { error: { message: string } | null }) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
};

/**
 * `resumed` = this account already had a claim on the record before this run (an earlier run stopped, or the
 * person pressed again after an error). Such a run cannot be taken back: the state from before the first run
 * is gone. Only a restore that ran in one go returns `undo`.
 */
export async function runRestore(
  deps: RestoreDeps,
  plan: RestorePlan,
  resumed: boolean,
): Promise<RestoreOutcome> {
  const { client, uid, storage } = deps;
  const now = deps.now ?? Date.now;
  let wrote = false;
  const undo: UndoInfo = {
    before: deps.before,
    settingsChanged: plan.settings !== null,
    selectionChanged: plan.selection !== null,
    kitIds: [],
    savedIds: [],
  };
  try {
    // 1. claim (before any write: a stopped run is then the only one that can finish)
    const claim = parseClaim(storage.getItem(LEGACY_CLAIM_KEY));
    if (claimOwner(claim, uid) === 'other')
      return { status: 'failed', message: 'claimed by another account', wrote };
    if (claimOwner(claim, uid) === 'none') {
      storage.setItem(LEGACY_CLAIM_KEY, serializeClaim({ uid, at: now() }));
      // two tabs: whoever wrote last stays; the other one must not go on
      if (
        claimOwner(parseClaim(storage.getItem(LEGACY_CLAIM_KEY)), uid) !==
        'mine'
      )
        return {
          status: 'failed',
          message: 'claimed by another account',
          wrote,
        };
    }

    // 2. kits (ids are new: an id of the old record may clash with another row's)
    const kits: IngredientKit[] = plan.kits.map((k) => ({
      ...k,
      id: deps.newId(),
    }));
    for (const part of chunks(kits, RESTORE_WRITE_CHUNK)) {
      const { data, error } = await client
        .from('ingredient_kits')
        .upsert(
          part.map((k) => kitToInsertRow(uid, k)),
          { onConflict: 'user_id,name', ignoreDuplicates: true },
        )
        .select('id');
      must('kits', { error });
      wrote = true;
      for (const row of (data ?? []) as { id: string }[])
        undo.kitIds.push(row.id);
    }

    // 3. ★
    const saved = plan.saved.map((s) => ({ ...s, id: deps.newId() }));
    for (const part of chunks(saved, RESTORE_WRITE_CHUNK)) {
      const ids = await deps.savedStore.addMany(part);
      wrote = true;
      undo.savedIds.push(...ids);
    }

    // 4. selection (the plan already carries the account's untouched side)
    if (plan.selection) {
      must(
        'selection',
        await client.rpc('set_food_prefs', selectionToRpcArgs(plan.selection)),
      );
      wrote = true;
    }

    // 5. settings
    if (plan.settings) {
      must(
        'settings',
        await client
          .from('profiles')
          .upsert(settingsToProfileRow(uid, plan.settings), {
            onConflict: 'id',
          }),
      );
      wrote = true;
    }

    // 6. the mark, last (only the columns given are written)
    must(
      'mark',
      await client
        .from('profiles')
        .upsert(
          { id: uid, legacy_imported_at: new Date(now()).toISOString() },
          { onConflict: 'id' },
        ),
    );
    wrote = true;
  } catch (e) {
    await deps.reload().catch(() => undefined); // show what did get there
    return { status: 'failed', message: messageOf(e), wrote };
  }
  await deps.reload().catch(() => undefined);
  return { status: 'done', undo: resumed ? null : undo };
}

/**
 * Takes a restore back. The mark goes first, so that if this stops half way the button is visible again and
 * pressing it restores once more; the claim goes last.
 */
export async function undoRestore(
  deps: RestoreDeps,
  undo: UndoInfo,
): Promise<void> {
  const { client, uid, storage } = deps;
  must(
    'unmark',
    await client
      .from('profiles')
      .upsert({ id: uid, legacy_imported_at: null }, { onConflict: 'id' }),
  );
  if (undo.settingsChanged)
    must(
      'settings',
      await client
        .from('profiles')
        .upsert(settingsToProfileRow(uid, undo.before.settings), {
          onConflict: 'id',
        }),
    );
  if (undo.selectionChanged)
    must(
      'selection',
      await client.rpc(
        'set_food_prefs',
        selectionToRpcArgs(undo.before.selection),
      ),
    );
  for (const part of chunks(undo.kitIds, RESTORE_WRITE_CHUNK))
    must(
      'kits',
      await client
        .from('ingredient_kits')
        .delete()
        .eq('user_id', uid)
        .in('id', part),
    );
  for (const part of chunks(undo.savedIds, RESTORE_WRITE_CHUNK))
    must(
      'saved',
      await client
        .from('saved_combos')
        .delete()
        .eq('user_id', uid)
        .in('id', part),
    );
  storage.removeItem(LEGACY_CLAIM_KEY);
  await deps.reload().catch(() => undefined);
}
