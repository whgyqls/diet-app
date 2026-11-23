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
};

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

    if (uid === null) {
      purgeCaches(null);
      publish({
        session: 'signed-out',
        uid: null,
        phase: 'idle',
        save: 'idle',
        error: null,
        savedStore: emptySavedStore,
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
    });
    await sync.start();
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
  };
}
