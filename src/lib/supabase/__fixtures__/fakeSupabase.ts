// An in-memory stand-in for the Supabase client, for unit tests of the sync layer.
// It keeps tables as arrays and understands only what the app uses: select/insert/upsert/update/delete with
// .eq() filters, .order(), .maybeSingle(), and the rpc set_food_prefs. Like RLS it only shows and changes rows
// of the signed-in user (`uid`), and refuses rows of other users. Calls are recorded, failures and delays can
// be injected per call.
import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
export type Call = {
  kind: 'select' | 'insert' | 'upsert' | 'update' | 'delete' | 'rpc';
  /** The table, or the function name for rpc. */
  table: string;
  filters: { col: string; val: unknown }[];
  payload?: unknown;
  options?: Record<string, unknown>;
};
export type FakeError = { message: string; code?: string };
type Result = { data: unknown; error: FakeError | null };

const UNIQUE: Record<string, string[]> = {
  saved_combos: ['user_id', 'signature'],
  ingredient_kits: ['user_id', 'name'],
  profiles: ['id'],
  food_prefs: ['user_id', 'item_id'],
  day_plans: ['user_id', 'date'],
};

/** Predicate helper: `is('upsert', 'saved_combos')`. */
export const is =
  (kind: Call['kind'], table?: string) =>
  (c: Call): boolean =>
    c.kind === kind && (table === undefined || c.table === table);

export function createFakeSupabase(init: {
  uid: string;
  tables?: Record<string, Row[]>;
}) {
  let uid = init.uid;
  const tables: Record<string, Row[]> = {
    profiles: [],
    food_prefs: [],
    ingredient_kits: [],
    saved_combos: [],
    day_plans: [],
  };
  for (const [t, rows] of Object.entries(init.tables ?? {}))
    tables[t] = structuredClone(rows);
  const calls: Call[] = [];
  const failures: {
    match: (c: Call) => boolean;
    error: FakeError;
    once: boolean;
  }[] = [];
  const holds: { match: (c: Call) => boolean; gate: Promise<void> }[] = [];

  const owned = (t: string, r: Row) =>
    (t === 'profiles' ? r.id : r.user_id) === uid;
  const matches = (r: Row, f: Call['filters']) =>
    f.every(({ col, val }) => r[col] === val);
  const keyOf = (t: string, r: Row, cols: string[] = UNIQUE[t] ?? ['id']) =>
    cols.map((c) => String(r[c])).join('|');
  const fail = (message: string, code: string): Result => ({
    data: null,
    error: { message, code },
  });
  const rowsOf = (payload: unknown) =>
    (Array.isArray(payload) ? payload : [payload]) as Row[];

  // The column defaults of 0001_init.sql (created_at / updated_at default now()) and its updated_at trigger.
  const STAMPED: Record<string, string[]> = {
    profiles: ['created_at', 'updated_at'],
    ingredient_kits: ['created_at', 'updated_at'],
    saved_combos: ['created_at'],
    day_plans: ['created_at'],
  };
  const withDefaults = (table: string, r: Row): Row => {
    const out = { ...r };
    const now = new Date().toISOString();
    for (const col of STAMPED[table] ?? [])
      if (out[col] === undefined) out[col] = now;
    // day_plans.id default gen_random_uuid()
    if (table === 'day_plans' && out.id === undefined)
      out.id = crypto.randomUUID();
    return out;
  };
  const touch = (table: string, r: Row) => {
    if (STAMPED[table]?.includes('updated_at'))
      r.updated_at = new Date().toISOString();
  };

  async function run(
    call: Call,
    single: boolean,
    order: { col: string; ascending: boolean } | null,
  ): Promise<Result> {
    calls.push(call);
    for (const h of holds.filter((x) => x.match(call))) await h.gate;
    const fi = failures.findIndex((f) => f.match(call));
    if (fi >= 0) {
      const f = failures[fi];
      if (f.once) failures.splice(fi, 1);
      return { data: null, error: f.error };
    }

    if (call.kind === 'rpc') {
      const { p_foods, p_seasonings } = (call.payload ?? {}) as Record<
        string,
        unknown
      >;
      const plain = (v: unknown): v is Record<string, unknown> =>
        typeof v === 'object' && v !== null && !Array.isArray(v);
      if (!plain(p_foods) || !plain(p_seasonings))
        return fail('selection must be two objects', '22023');
      if (Object.keys(p_foods).length + Object.keys(p_seasonings).length > 500)
        return fail('too many items', '22023');
      const next: Row[] = [];
      for (const [kind, map] of [
        ['food', p_foods],
        ['seasoning', p_seasonings],
      ] as const)
        for (const [item_id, status] of Object.entries(map)) {
          if (status !== 'ok' && status !== 'favorite')
            return fail('bad status', '23514');
          next.push({ user_id: uid, item_id, kind, status });
        }
      tables.food_prefs = tables.food_prefs
        .filter((r) => r.user_id !== uid)
        .concat(next);
      return { data: null, error: null };
    }

    const table = call.table;
    const rows = (tables[table] ??= []);
    switch (call.kind) {
      case 'select': {
        const found = rows
          .filter((r) => owned(table, r) && matches(r, call.filters))
          .map((r) => ({ ...r }));
        if (order)
          found.sort((a, b) => {
            const av = a[order.col] as string | number;
            const bv = b[order.col] as string | number;
            return (
              (av === bv ? 0 : av > bv ? 1 : -1) * (order.ascending ? 1 : -1)
            );
          });
        return { data: single ? (found[0] ?? null) : found, error: null };
      }
      case 'insert': {
        const incoming = rowsOf(call.payload);
        if (incoming.some((r) => !owned(table, r)))
          return fail('new row violates row-level security policy', '42501');
        const keys = new Set(rows.map((r) => keyOf(table, r)));
        for (const r of incoming) {
          const k = keyOf(table, r);
          if (keys.has(k))
            return fail(
              'duplicate key value violates unique constraint',
              '23505',
            );
          keys.add(k);
        }
        rows.push(...incoming.map((r) => withDefaults(table, r)));
        return { data: null, error: null };
      }
      case 'upsert': {
        const incoming = rowsOf(call.payload);
        if (incoming.some((r) => !owned(table, r)))
          return fail('new row violates row-level security policy', '42501');
        const onConflict = call.options?.onConflict;
        const cols =
          typeof onConflict === 'string'
            ? onConflict.split(',').map((c) => c.trim())
            : undefined;
        for (const r of incoming) {
          const k = keyOf(table, r, cols);
          const existing = rows.find((x) => keyOf(table, x, cols) === k);
          if (existing) {
            if (!call.options?.ignoreDuplicates) {
              Object.assign(existing, r);
              touch(table, existing);
            }
          } else rows.push(withDefaults(table, r));
        }
        return { data: null, error: null };
      }
      case 'update': {
        const patch = (call.payload ?? {}) as Row;
        const targets = rows.filter(
          (r) => owned(table, r) && matches(r, call.filters),
        );
        if (table === 'ingredient_kits' && typeof patch.name === 'string')
          for (const t of targets)
            if (
              rows.some(
                (r) =>
                  owned(table, r) && r.id !== t.id && r.name === patch.name,
              )
            )
              return fail(
                'duplicate key value violates unique constraint',
                '23505',
              );
        for (const t of targets) {
          Object.assign(t, patch);
          touch(table, t);
        }
        return { data: null, error: null };
      }
      case 'delete':
        tables[table] = rows.filter(
          (r) => !(owned(table, r) && matches(r, call.filters)),
        );
        return { data: null, error: null };
    }
  }

  class Builder implements PromiseLike<Result> {
    private call: Call;
    private single = false;
    private ord: { col: string; ascending: boolean } | null = null;
    constructor(table: string, kind?: Call['kind']) {
      this.call = { kind: kind ?? 'select', table, filters: [] };
    }
    select() {
      return this; // after insert/upsert/... it only asks for the rows back; not needed here
    }
    insert(payload: unknown) {
      this.call.kind = 'insert';
      this.call.payload = payload;
      return this;
    }
    upsert(payload: unknown, options?: Record<string, unknown>) {
      this.call.kind = 'upsert';
      this.call.payload = payload;
      this.call.options = options;
      return this;
    }
    update(payload: unknown) {
      this.call.kind = 'update';
      this.call.payload = payload;
      return this;
    }
    delete() {
      this.call.kind = 'delete';
      return this;
    }
    eq(col: string, val: unknown) {
      this.call.filters.push({ col, val });
      return this;
    }
    order(col: string, o?: { ascending?: boolean }) {
      this.ord = { col, ascending: o?.ascending ?? true };
      return this;
    }
    maybeSingle() {
      this.single = true;
      return this;
    }
    then<A = Result, B = never>(
      onfulfilled?: ((v: Result) => A | PromiseLike<A>) | null,
      onrejected?: ((r: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return run(this.call, this.single, this.ord).then(
        onfulfilled,
        onrejected,
      );
    }
  }

  // A stand-in for supabase.auth: only the session events the account runtime listens to.
  type AuthEvent = (
    event: string,
    session: { user: { id: string } } | null,
  ) => void;
  const authListeners = new Set<AuthEvent>();
  let session: { user: { id: string } } | null = init.uid
    ? { user: { id: init.uid } }
    : null;
  const auth = {
    onAuthStateChange: (cb: AuthEvent) => {
      authListeners.add(cb);
      return {
        data: {
          subscription: { unsubscribe: () => void authListeners.delete(cb) },
        },
      };
    },
    getSession: async () => ({ data: { session }, error: null }),
  };

  const client = {
    auth,
    from: (table: string) => new Builder(table),
    rpc: (fn: string, payload: unknown) => {
      const b = new Builder(fn, 'rpc');
      (b as unknown as { call: Call }).call.payload = payload;
      return b;
    },
  } as unknown as SupabaseClient;

  return {
    client,
    tables,
    /** Sign in as another user (the fake then shows that user's rows only, like RLS). */
    setUid(next: string) {
      uid = next;
    },
    /** Send an auth event to the listeners; null = signed out. */
    emitAuth(event: string, as: string | null) {
      session = as ? { user: { id: as } } : null;
      authListeners.forEach((cb) => cb(event, session));
    },
    calls,
    /** Every call that changes data (select is not a write). */
    writes: () => calls.filter((c) => c.kind !== 'select'),
    /** The next matching call (or every matching call with once = false) fails with this error. */
    failWhen(
      match: (c: Call) => boolean,
      error: FakeError = { message: 'boom', code: 'XX000' },
      once = true,
    ) {
      failures.push({ match, error, once });
    },
    /** Matching calls wait until the returned function is called. */
    holdWhen(match: (c: Call) => boolean): () => void {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      holds.push({ match, gate });
      return release;
    },
  };
}
