// Ties the signed-in user to the app: which account's data is in the store, where its cache lives, and the
// sync that keeps it in step with the server. Not React: the screens read it through src/lib/account/useAccount.ts.
//
// Per sign-in (or user switch):
//  1. the store is emptied (nothing of the previous user stays in memory) and the other users' caches are deleted;
//  2. the persist name becomes this user's cache key, and the cache is used only if pickCache says it belongs
//     to this user; otherwise it is deleted. The old pre-login keys are never read (see accountCacheOnly);
//  3. createAccountSync loads the server values, which replace the cache; the saved (★) store loads too.
// On sign-out the store is emptied, the persist name goes back to the placeholder and the caches are deleted.
import type { SupabaseClient } from '@supabase/supabase-js';
import { KNOWN_IDS } from '@/lib/data/knownIds';
import {
  createLocalSavedStore,
  type SavedCombo,
  type SavedStore,
} from '@/lib/plan/savedCombos';
import type { createAppStore } from '@/lib/store/appStore';
import type { StateStorage } from '@/lib/store/safeStorage';
import type { KnownItemIds } from '@/lib/validate/validate';
import type { AccountPhase, SessionState } from '@/lib/supabase/accountGate';
import {
  createAccountSync,
  type AccountSync,
  type SaveStatus,
} from '@/lib/supabase/accountSync';
import {
  NO_ACCOUNT_CACHE_KEY,
  accountCacheKey,
  pickCache,
  staleCacheKeys,
} from '@/lib/supabase/cacheOwner';
import { createSupabaseSavedStore } from '@/lib/supabase/savedRemote';
import { newUuid } from '@/lib/id/newUuid';
import {
  LEGACY_CLAIM_KEY,
  claimOwner,
  parseClaim,
} from '@/lib/legacy/legacyClaim';
import { planRestore, type RestorePlan } from '@/lib/legacy/planRestore';
import { restoreUi } from '@/lib/legacy/restoreUi';
import { isLegacyEmpty, readLegacyRecord } from '@/lib/legacy/readLegacy';
import {
  runRestore,
  undoRestore,
  type RestoreDeps,
  type UndoInfo,
} from '@/lib/legacy/restoreRunner';
import { LEGACY_SAVED_KEY, LEGACY_STATE_KEY } from '@/lib/supabase/cacheOwner';

export type CacheStorage = StateStorage & { keys: () => string[] };
type AppStoreApi = ReturnType<typeof createAppStore>;

export type AccountSnapshot = {
  session: SessionState;
  uid: string | null;
  phase: AccountPhase;
  save: SaveStatus;
  /** Message of the last failed load or write (for the "저장하지 못했어요" notice). */
  error: string | null;
  /** The ★ store of the signed-in user; an inert one while the session is unknown or nobody is signed in. */
  savedStore: SavedStore;
  /** When this account loaded its previous record (ms), or null: the button "이전 기록 불러오기" shows while null. */
  legacyImportedAt: number | null;
};

/** What the button would do right now (PLAN.md 9.2). */
export type LegacyOffer = {
  plan: RestorePlan;
  dropped: { kits: number; saved: number };
  /** An earlier run of this account stopped: the next one finishes it and cannot be undone. */
  resumed: boolean;
};

export type RestoreResult =
  | {
      status: 'done';
      plan: RestorePlan;
      dropped: { kits: number; saved: number };
      /** Can be taken back (only a restore that ran in one go). */
      undoable: boolean;
    }
  | { status: 'failed'; wrote: boolean };

const NO_SAVED: SavedCombo[] = [];

/**
 * Shown until the session is known: loading for ever, changes are refused.
 * list() must return the SAME array every time: React's useSyncExternalStore calls it on every render and
 * loops for ever when it gets a new array each time.
 */
export const pendingSavedStore: SavedStore = {
  list: () => NO_SAVED,
  status: () => 'loading',
  subscribe: () => () => {},
  refresh: async () => {},
  toggle: async () => {
    throw new Error('account not ready');
  },
  remove: async () => {
    throw new Error('account not ready');
  },
  addMany: async () => {
    throw new Error('account not ready');
  },
};

export const INITIAL_SNAPSHOT: AccountSnapshot = {
  session: 'unknown',
  uid: null,
  phase: 'idle',
  save: 'idle',
  error: null,
  savedStore: pendingSavedStore,
  legacyImportedAt: null,
};

const memoryStorage = (): StateStorage => {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

export type AccountRuntime = ReturnType<typeof createAccountRuntime>;

export function createAccountRuntime(deps: {
  client: SupabaseClient;
  appStore: AppStoreApi;
  storage: CacheStorage;
  known?: KnownItemIds;
  debounceMs?: number;
}) {
  const { client, appStore, storage } = deps;
  const known = deps.known ?? KNOWN_IDS;
  // a visitor's ★ store lives in memory only: nothing is written to the legacy saved key
  const emptySavedStore = createLocalSavedStore(memoryStorage());

  let snapshot: AccountSnapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<AccountSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((fn) => fn());
  };

  let current: { sync: AccountSync; unsubscribe: () => void } | null = null;
  let activeUid: string | null = null; // the uid being set up or set up
  let token = 0;
  let detached = false;
  let restoring: Promise<RestoreResult> | null = null; // one restore at a time, however often the button is pressed
  let lastUndo: UndoInfo | null = null;

  const teardown = () => {
    current?.unsubscribe();
    current?.sync.stop();
    current = null;
  };
  /** Nobody's data in memory, and nothing the store changes is saved anywhere. */
  const leaveAccount = () => {
    appStore.persist.setOptions({ name: NO_ACCOUNT_CACHE_KEY });
    appStore.getState().resetAccountData();
  };
  const purgeCaches = (keepUid: string | null) => {
    for (const k of staleCacheKeys(storage.keys(), keepUid))
      storage.removeItem(k);
  };

  async function applySession(uid: string | null): Promise<void> {
    if (detached) return;
    if (uid === activeUid && snapshot.session !== 'unknown') return;
    activeUid = uid;
    const mine = ++token;
    teardown();
    leaveAccount();
    restoreUi.reset(); // the result line and the undo window of the previous account are gone
    lastUndo = null;

    if (uid === null) {
      purgeCaches(null);
      publish({
        session: 'signed-out',
        uid: null,
        phase: 'idle',
        save: 'idle',
        error: null,
        savedStore: emptySavedStore,
        legacyImportedAt: null,
      });
      return;
    }

    purgeCaches(uid);
    const key = accountCacheKey(uid);
    appStore.persist.setOptions({ name: key });
    const raw = storage.getItem(key);
    if (pickCache(uid, key, raw).use) await appStore.persist.rehydrate();
    else if (raw !== null) storage.removeItem(key);
    if (mine !== token || detached) return;
    appStore.getState().setOwner(uid);

    const sync = createAccountSync({
      client,
      uid,
      store: appStore,
      known,
      debounceMs: deps.debounceMs,
    });
    const savedStore = createSupabaseSavedStore(client, uid, known);
    const unsubscribe = sync.subscribe(() =>
      publish({
        phase: sync.phase(),
        save: sync.saveStatus(),
        error: sync.lastError(),
        legacyImportedAt: sync.legacyImportedAt(),
      }),
    );
    current = { sync, unsubscribe };
    publish({
      session: 'signed-in',
      uid,
      phase: sync.phase(),
      save: 'idle',
      error: null,
      savedStore,
      legacyImportedAt: null,
    });
    await sync.start();
  }

  // ---- "이전 기록 불러오기" (PLAN.md 9.2) ----

  const accountData = () => {
    const st = appStore.getState();
    return {
      profile: st.profile,
      styles: st.styles,
      overrides: st.overrides,
      selection: st.selection,
      kits: st.kits,
      savedSignatures: new Set(
        snapshot.savedStore.list().map((x) => x.signature),
      ),
    };
  };

  function legacyOffer(): LegacyOffer | null {
    const uid = snapshot.uid;
    if (
      !uid ||
      snapshot.session !== 'signed-in' ||
      snapshot.phase !== 'ready' ||
      snapshot.savedStore.status() !== 'ready' ||
      snapshot.legacyImportedAt !== null
    )
      return null;
    const owner = claimOwner(
      parseClaim(storage.getItem(LEGACY_CLAIM_KEY)),
      uid,
    );
    if (owner === 'other') return null; // another account's record: not read at all
    const record = readLegacyRecord(
      storage.getItem(LEGACY_STATE_KEY),
      storage.getItem(LEGACY_SAVED_KEY),
      KNOWN_IDS,
    );
    if (isLegacyEmpty(record)) return null;
    return {
      plan: planRestore(record, accountData()),
      dropped: record.dropped,
      resumed: owner === 'mine',
    };
  }

  const restoreDeps = (uid: string): RestoreDeps => {
    const st = appStore.getState();
    return {
      client,
      uid,
      savedStore: snapshot.savedStore,
      storage,
      before: {
        settings: {
          profile: st.profile,
          styles: st.styles,
          overrides: st.overrides,
        },
        selection: st.selection,
      },
      reload: async () => {
        await current?.sync.reload();
        await snapshot.savedStore.refresh();
      },
      newId: () => newUuid(),
    };
  };

  async function restoreLegacy(): Promise<RestoreResult> {
    if (restoring) return restoring; // a second press joins the run in progress
    const run = (async (): Promise<RestoreResult> => {
      const uid = snapshot.uid;
      if (!uid) return { status: 'failed', wrote: false };
      // edits that are still waiting for the save go first, so the plan is made from what the server has
      await current?.sync.flush().catch(() => undefined);
      const offer = legacyOffer();
      if (!offer) return { status: 'failed', wrote: false };
      const out = await runRestore(restoreDeps(uid), offer.plan, offer.resumed);
      if (out.status === 'failed')
        return { status: 'failed', wrote: out.wrote };
      lastUndo = out.undo;
      return {
        status: 'done',
        plan: offer.plan,
        dropped: offer.dropped,
        undoable: out.undo !== null,
      };
    })();
    restoring = run;
    try {
      return await run;
    } finally {
      restoring = null;
    }
  }

  /** Takes the last restore back (only possible for one that ran in one go). Throws when a step fails. */
  async function undoLegacy(): Promise<void> {
    const uid = snapshot.uid;
    const undo = lastUndo;
    if (!uid || !undo) return;
    await undoRestore(restoreDeps(uid), undo);
    lastUndo = null;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    /**
     * Listens to the sign-in state. Returns the function that stops it.
     * It can be started again after it was stopped: React runs an effect as start, stop, start in development
     * (Strict Mode), and a stop must not leave the runtime dead.
     */
    start(): () => void {
      detached = false;
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const uid = session?.user?.id ?? null;
        // Not inside the callback: the auth client holds a lock while it runs, and our own requests need it.
        setTimeout(() => void applySession(uid), 0);
      });
      // in case no INITIAL_SESSION event arrives
      void client.auth.getSession().then(({ data: d }) => {
        if (snapshot.session === 'unknown')
          void applySession(d.session?.user?.id ?? null);
      });
      return () => {
        detached = true;
        token += 1; // a sign-in that is still being set up must not finish
        data.subscription.unsubscribe();
        teardown();
        activeUid = null;
        snapshot = INITIAL_SNAPSHOT; // back to "session not known": the next start begins again
        listeners.forEach((fn) => fn());
      };
    },
    applySession,
    /** Writes waiting edits now (before a logout). */
    flush: async () => {
      await current?.sync.flush();
    },
    /** After an error: load the account data and the ★ again. */
    retry: async () => {
      await current?.sync.reload();
      await snapshot.savedStore.refresh();
    },
    clearError: () => current?.sync.clearError(),
    hasUnsavedChanges: () => current?.sync.hasUnsavedChanges() ?? false,
    legacyOffer,
    restoreLegacy,
    undoLegacy,
  };
}
