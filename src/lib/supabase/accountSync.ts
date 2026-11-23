// Keeps the account data (profile, styles, overrides, selection, ingredient kits) of the app store in step with
// the server. Saved combos have their own store (savedRemote.ts).
//
// Order of things (PLAN 5d, "동기화 순서와 에코 방지"):
// 1. load: read profiles / food_prefs / ingredient_kits of `uid`. First login (no profiles row): create the row
//    with upsert({ id }) that ignores an existing one, nothing else.
// 2. replace the store's synced parts with the server values as a whole (server wins, no merge with a cache),
//    and remember them as `lastSynced`.
// 3. only then start listening to the store. Edits made while loading are not written; the load replaces them.
// 4. writes are driven by diffForSync(lastSynced, current): a value that came from the server equals lastSynced
//    and is never written back. Edits are collected for SYNC_DEBOUNCE_MS, then written in one round.
// 5. a failed write: remember the error (for the "저장하지 못했어요" notice) and load the server values again,
//    which undoes the edits that did not reach the server. No automatic retry loop.
import type { SupabaseClient } from '@supabase/supabase-js';
import { KNOWN_IDS } from '@/lib/data/knownIds';
import type { KnownItemIds } from '@/lib/validate/validate';
import type { AccountPhase } from './accountGate';
import {
  foodPrefRowsToSelection,
  kitRowsToKits,
  kitToInsertRow,
  profileRowToSettings,
  selectionToRpcArgs,
  settingsToProfileRow,
} from './mappers';
import { SYNC_DEBOUNCE_MS } from './syncConstants';
import {
  cloneSyncState,
  diffForSync,
  hasSyncOps,
  toSyncState,
  type SyncOps,
  type SyncState,
} from './syncDiff';

/** The part of the app store (zustand) this needs. The real store fits this shape. */
export type AccountStore = {
  getState: () => SyncState;
  setState: (partial: SyncState) => void;
  subscribe: (listener: () => void) => () => void;
};

/** idle = nothing to write, pending = edits waiting for the debounce, saving = a write is running. */
export type SaveStatus = 'idle' | 'pending' | 'saving';

export type AccountSync = {
  phase(): AccountPhase;
  saveStatus(): SaveStatus;
  /** Message of the last failed load or write, until a write succeeds or clearError() is called. */
  lastError(): string | null;
  clearError(): void;
  /** True while edits wait or are being written (for the beforeunload warning). */
  hasUnsavedChanges(): boolean;
  /** When this account used "이전 기록 불러오기" (ms), or null. Read with the profile. */
  legacyImportedAt(): number | null;
  subscribe(fn: () => void): () => void;
  /** First load, then listen to the store. Calling it again does nothing. */
  start(): Promise<void>;
  /** Load the server values again (retry after an error). Waits for a running write first. */
  reload(): Promise<void>;
  /** Write waiting edits now instead of after the debounce. */
  flush(): Promise<void>;
  /** Stop listening and drop a waiting write (logout, user switch). */
  stop(): void;
};

type ErrorLike = { message?: string } | Error;
const toError = (e: ErrorLike): Error =>
  e instanceof Error ? e : new Error(e.message ?? 'account request failed');
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createAccountSync(opts: {
  client: SupabaseClient;
  uid: string;
  store: AccountStore;
  known?: KnownItemIds;
  debounceMs?: number;
}): AccountSync {
  const { client, uid, store } = opts;
  const known = opts.known ?? KNOWN_IDS;
  const debounceMs = opts.debounceMs ?? SYNC_DEBOUNCE_MS;

  let phase: AccountPhase = 'idle';
  let save: SaveStatus = 'idle';
  let error: string | null = null;
  let legacyAt: number | null = null;
  let lastSynced: SyncState | null = null;
  let applying = false; // the store is being replaced by server values
  let started = false;
  let stopped = false;
  let loadSeq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> | null = null;
  let unsubscribeStore: (() => void) | null = null;

  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const check = async (req: PromiseLike<{ error: ErrorLike | null }>) => {
    const { error: e } = await req;
    if (e) throw toError(e);
  };

  async function fetchAccount(): Promise<SyncState> {
    const [p, f, k] = await Promise.all([
      client.from('profiles').select('*').eq('id', uid).maybeSingle(),
      client
        .from('food_prefs')
        .select('item_id,kind,status')
        .eq('user_id', uid),
      client.from('ingredient_kits').select('*').eq('user_id', uid),
    ]);
    const failed = p.error ?? f.error ?? k.error;
    if (failed) throw toError(failed);
    if (!p.data)
      // first login: create the empty profiles row (does nothing if another tab made it meanwhile)
      await check(
        client
          .from('profiles')
          .upsert({ id: uid }, { onConflict: 'id', ignoreDuplicates: true }),
      );
    const settings = profileRowToSettings(p.data);
    legacyAt = settings.legacyImportedAt;
    return {
      profile: settings.profile,
      styles: settings.styles,
      overrides: settings.overrides,
      selection: foodPrefRowsToSelection(f.data, known),
      kits: kitRowsToKits(k.data, known),
    };
  }

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    cancelTimer();
    phase = 'loading';
    emit();
    try {
      const server = await fetchAccount();
      if (stopped || seq !== loadSeq) return;
      applying = true;
      try {
        store.setState(server);
      } finally {
        applying = false;
      }
      lastSynced = cloneSyncState(server);
      phase = 'ready';
      save = 'idle';
      unsubscribeStore ??= store.subscribe(onStoreChange);
      emit();
    } catch (e) {
      if (stopped || seq !== loadSeq) return;
      error = messageOf(e);
      phase = 'error';
      emit();
    }
  }

  function currentOps(): SyncOps | null {
    if (phase !== 'ready' || lastSynced === null) return null;
    const ops = diffForSync(lastSynced, toSyncState(store.getState()));
    return hasSyncOps(ops) ? ops : null;
  }

  function schedule() {
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
    if (save === 'idle') {
      save = 'pending';
      emit();
    }
  }

  function onStoreChange() {
    if (applying || stopped || phase !== 'ready') return;
    if (currentOps()) schedule();
    else if (save === 'pending') {
      // the edit was taken back before it was written
      cancelTimer();
      save = 'idle';
      emit();
    }
  }

  /** Runs the operations in order: kits delete, update, add; then the profile row; then the selection. */
  async function writeOps(ops: SyncOps, target: SyncState) {
    const kits = () => client.from('ingredient_kits');
    for (const id of ops.kitsDeleted) {
      await check(kits().delete().eq('user_id', uid).eq('id', id));
      lastSynced = {
        ...lastSynced!,
        kits: lastSynced!.kits.filter((k) => k.id !== id),
      };
    }
    for (const k of ops.kitsUpdated) {
      await check(
        kits()
          .update({
            name: k.name,
            selection: {
              foods: { ...k.selection.foods },
              seasonings: { ...k.selection.seasonings },
            },
            styles: k.styles ? [...k.styles] : null,
          })
          .eq('user_id', uid)
          .eq('id', k.id),
      );
      lastSynced = {
        ...lastSynced!,
        kits: lastSynced!.kits.map((x) => (x.id === k.id ? k : x)),
      };
    }
    for (const k of ops.kitsAdded) {
      await check(kits().insert(kitToInsertRow(uid, k)));
      lastSynced = { ...lastSynced!, kits: [...lastSynced!.kits, k] };
    }
    if (ops.settings) {
      await check(
        client
          .from('profiles')
          .upsert(settingsToProfileRow(uid, target), { onConflict: 'id' }),
      );
      lastSynced = {
        ...lastSynced!,
        profile: target.profile,
        styles: target.styles,
        overrides: target.overrides,
      };
    }
    if (ops.selection) {
      await check(
        client.rpc('set_food_prefs', selectionToRpcArgs(target.selection)),
      );
      lastSynced = { ...lastSynced!, selection: target.selection };
    }
  }

  function flush(): Promise<void> {
    cancelTimer();
    if (writing) return writing.then(() => flush()); // one write at a time, then the newest edits
    const ops = currentOps();
    if (!ops) {
      if (save !== 'idle') {
        save = 'idle';
        emit();
      }
      return Promise.resolve();
    }
    const target = cloneSyncState(toSyncState(store.getState()));
    save = 'saving';
    emit();
    const run: Promise<void> = writeOps(ops, target).then(
      () => {
        writing = null;
        error = null;
        if (!stopped && currentOps()) {
          save = 'idle';
          schedule(); // edited again while this write ran
        } else {
          save = 'idle';
          emit();
        }
      },
      async (e: unknown) => {
        writing = null;
        error = messageOf(e);
        save = 'idle';
        emit();
        if (!stopped) await load(); // server values undo what did not get there
      },
    );
    writing = run;
    return run;
  }

  return {
    phase: () => phase,
    saveStatus: () => save,
    lastError: () => error,
    clearError() {
      if (error === null) return;
      error = null;
      emit();
    },
    hasUnsavedChanges: () => save !== 'idle',
    legacyImportedAt: () => legacyAt,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    async start() {
      if (started) return;
      started = true;
      await load();
    },
    async reload() {
      if (writing) await writing.catch(() => undefined);
      await load();
    },
    flush,
    stop() {
      stopped = true;
      cancelTimer();
      unsubscribeStore?.();
      unsubscribeStore = null;
    },
  };
}
