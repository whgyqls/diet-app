// Server data of the e2e test users (the app reads and writes it on the TEST Supabase project since Phase 5d).
//
// Safety, all of it in this file:
// - every call goes through testAdmin(), which runs the test project guard first (testProjectGuard.ts), so
//   nothing here can reach a project that is not the marked test project;
// - only users that the e2e fixtures created in this run are accepted (registerUser), never an arbitrary id;
// - every delete names the user: .eq('user_id', uid) (profiles: .eq('id', uid)). There is no unfiltered delete.
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadTestProject } from '../../helpers/testProjectGuard';

export type SeedKit = {
  id?: string;
  name: string;
  selection: {
    foods: Record<string, string>;
    seasonings: Record<string, string>;
  };
  styles?: string[] | null;
};
export type SeedSaved = {
  id: string;
  savedAt: number;
  mealType: string;
  requestFingerprint: string;
  signature: string;
  items: unknown[];
  oils: unknown[];
  seasonings: unknown[];
  totals: unknown;
};
/** Same shape the localStorage seeds had: profile, styles, overrides, selection, kits, plus saved (★) combos. */
export type SeedData = {
  profile?: Record<string, unknown>;
  styles?: string[];
  overrides?: Record<string, unknown>;
  selection?: {
    foods?: Record<string, string>;
    seasonings?: Record<string, string>;
  };
  kits?: SeedKit[];
  saved?: SeedSaved[];
};

let admin: SupabaseClient | null = null;
/** The service-key client of the test project. Throws unless the guard passes. */
export function testAdmin(): SupabaseClient {
  if (admin) return admin;
  const project = loadTestProject(); // throws unless this is the marked test project
  admin = createClient(project.url, project.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

const registered = new Set<string>();
export const registerUser = (uid: string) => void registered.add(uid);
export const unregisterUser = (uid: string) => void registered.delete(uid);

let active: string | null = null;
export const setActiveUser = (uid: string) => void (active = uid);
export function activeUser(): string {
  if (!active)
    throw new Error(
      'no e2e test user is active (use the fixtures in tests/e2e/fixtures.ts)',
    );
  return active;
}

/** Only a user this run created. */
function own(uid: string): string {
  if (!registered.has(uid))
    throw new Error(
      'refusing to touch data of a user that the e2e fixtures did not create',
    );
  return uid;
}

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const must = (what: string, r: { error: { message: string } | null }) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
};

/** Deletes everything of this user: ★, kits, food preferences, profile row. Always by the user's id. */
export async function resetUserData(uid: string): Promise<void> {
  const a = testAdmin();
  own(uid);
  must(
    'reset saved_combos',
    await a.from('saved_combos').delete().eq('user_id', uid),
  );
  must(
    'reset ingredient_kits',
    await a.from('ingredient_kits').delete().eq('user_id', uid),
  );
  must(
    'reset food_prefs',
    await a.from('food_prefs').delete().eq('user_id', uid),
  );
  must('reset profiles', await a.from('profiles').delete().eq('id', uid));
}

export async function seedUserData(uid: string, data: SeedData): Promise<void> {
  const a = testAdmin();
  own(uid);
  if (data.profile || data.styles || data.overrides) {
    const p = (data.profile ?? {}) as Record<string, unknown>;
    const overrides =
      data.overrides && Object.keys(data.overrides).length > 0
        ? data.overrides
        : null;
    must(
      'seed profiles',
      await a.from('profiles').upsert(
        {
          id: uid,
          sex: p.sex ?? null,
          birth_year: p.birthYear ?? null,
          height_cm: p.heightCm ?? null,
          weight_kg: p.weightKg ?? null,
          activity_level: p.activityLevel ?? null,
          goal: p.goal ?? null,
          meals_per_day: p.mealsPerDay ?? null,
          styles: data.styles ?? [],
          custom_targets: overrides,
        },
        { onConflict: 'id' },
      ),
    );
  }
  if (data.selection) {
    const rows = [
      ...Object.entries(data.selection.foods ?? {}).map(
        ([item_id, status]) => ({
          user_id: uid,
          item_id,
          kind: 'food',
          status,
        }),
      ),
      ...Object.entries(data.selection.seasonings ?? {}).map(
        ([item_id, status]) => ({
          user_id: uid,
          item_id,
          kind: 'seasoning',
          status,
        }),
      ),
    ];
    if (rows.length > 0)
      must('seed food_prefs', await a.from('food_prefs').insert(rows));
  }
  if (data.kits?.length) {
    must(
      'seed ingredient_kits',
      await a.from('ingredient_kits').insert(
        data.kits.map((k) => ({
          id: isUuid(k.id) ? k.id : randomUUID(),
          user_id: uid,
          name: k.name,
          selection: k.selection,
          styles: k.styles ?? null,
        })),
      ),
    );
  }
  if (data.saved?.length) {
    must(
      'seed saved_combos',
      await a.from('saved_combos').insert(
        data.saved.map((s) => ({
          id: isUuid(s.id) ? s.id : randomUUID(), // the table's id is a uuid; tests may use short ids
          user_id: uid,
          meal_type: s.mealType,
          signature: s.signature,
          request_fingerprint: s.requestFingerprint,
          items: s.items,
          oils: s.oils,
          seasonings: s.seasonings,
          totals: s.totals,
          created_at: new Date(s.savedAt).toISOString(),
        })),
      ),
    );
  }
}

/** Seeds the user of the running test (set by the fixtures). */
export const seedServer = (data: SeedData) => seedUserData(activeUser(), data);

/** Waits until the user has exactly n saved (★) combos on the server (★ writes are not in the "저장 중…" mark). */
export async function waitForSavedCombos(
  n: number,
  timeoutMs = 15_000,
): Promise<void> {
  const a = testAdmin();
  const uid = own(activeUser());
  const end = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < end) {
    const { count, error } = await a
      .from('saved_combos')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid);
    if (error) throw new Error(`count saved_combos: ${error.message}`);
    last = count ?? 0;
    if (last === n) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`expected ${n} saved combos on the server, found ${last}`);
}
