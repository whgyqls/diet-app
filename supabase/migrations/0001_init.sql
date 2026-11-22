-- Phase 5: account data (profile, food preferences, ingredient kits, saved combos) with RLS.
-- Every user table is readable and writable only by its owner (auth.uid()). anon gets nothing.
-- day_plans, ai_explanations and ai_usage are not here (no screen uses day_plans yet; the AI tables are Phase 6).
--
-- Value ranges that the app checks (profile limits, override limits, known food ids) live in the app
-- (src/lib/nutrition/constants.ts, src/lib/validate). The checks below are sanity bounds and shape checks
-- only, so the DB and constants.ts do not have to be kept in sync number by number.

-- One transaction: if any statement fails, nothing of this migration is left behind.
begin;

-- -------------------------------------------------------------------------------------------------
-- Helpers
-- -------------------------------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

-- -------------------------------------------------------------------------------------------------
-- profiles: one row per user. Columns are nullable because onboarding saves a partial profile.
-- The row is created by the client with upsert({ id: auth.uid() }) after the first login (no auth trigger).
-- -------------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  sex text check (sex in ('female', 'male')),
  birth_year smallint check (birth_year between 1900 and 2100),
  height_cm numeric(5, 1) check (height_cm > 0 and height_cm < 300),
  weight_kg numeric(5, 1) check (weight_kg > 0 and weight_kg < 500),
  activity_level smallint check (activity_level between 1 and 5),
  goal text check (goal in ('lose', 'maintain', 'gain')),
  meals_per_day smallint check (meals_per_day in (2, 3)),
  -- DietStyle values (src/types/nutrition.ts). A new style needs a migration that widens this list.
  styles text[] not null default '{}' check (
    styles <@ array['lowCarb', 'lowSodium', 'veggieForward', 'highProtein', 'pescatarian', 'lactoOvo']
  ),
  -- TargetOverrides; null = no overrides
  custom_targets jsonb check (
    custom_targets is null
    or (jsonb_typeof(custom_targets) = 'object' and pg_column_size(custom_targets) < 4096)
  ),
  -- set when "이전 기록 불러오기" was used by this account; cleared by its undo
  legacy_imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------------------------------
-- food_prefs: one row per food or seasoning the user can eat. No row = cannot eat.
-- Food and seasoning ids do not overlap in data/, so (user_id, item_id) is the key (PLAN.md 6.3).
-- Clients cannot write this table directly: set_food_prefs() below is the only write path.
-- -------------------------------------------------------------------------------------------------

create table public.food_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null check (char_length(item_id) between 1 and 64),
  kind text not null check (kind in ('food', 'seasoning')),
  status text not null check (status in ('ok', 'favorite')),
  primary key (user_id, item_id)
);

-- -------------------------------------------------------------------------------------------------
-- ingredient_kits: "내 재료 세트". The id is a uuid made by the client (optimistic updates keep it).
-- -------------------------------------------------------------------------------------------------

create table public.ingredient_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- same rule as validateKitName: trimmed, 1..20 characters
  name text not null check (name = btrim(name) and char_length(name) between 1 and 20),
  -- { foods: {id: status}, seasonings: {id: status} }
  selection jsonb not null check (
    jsonb_typeof(selection) = 'object' and pg_column_size(selection) < 16384
  ),
  -- null = styles were not saved with this kit
  styles text[] check (
    styles is null
    or styles <@ array['lowCarb', 'lowSodium', 'veggieForward', 'highProtein', 'pescatarian', 'lactoOvo']
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create trigger ingredient_kits_set_updated_at
before update on public.ingredient_kits
for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------------------------------
-- saved_combos: ★ snapshots (src/lib/plan/savedCombos.ts SavedCombo). created_at = savedAt.
-- The same signature can be saved once per user; two users can save the same signature.
-- -------------------------------------------------------------------------------------------------

create table public.saved_combos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  signature text not null check (char_length(signature) between 1 and 1000),
  request_fingerprint text not null check (char_length(request_fingerprint) <= 1000),
  items jsonb not null check (jsonb_typeof(items) = 'array' and pg_column_size(items) < 16384),
  oils jsonb not null check (jsonb_typeof(oils) = 'array' and pg_column_size(oils) < 16384),
  seasonings jsonb not null check (
    jsonb_typeof(seasonings) = 'array' and pg_column_size(seasonings) < 16384
  ),
  totals jsonb not null check (jsonb_typeof(totals) = 'object' and pg_column_size(totals) < 16384),
  created_at timestamptz not null default now(),
  unique (user_id, signature)
);

create index saved_combos_user_created_idx on public.saved_combos (user_id, created_at desc);

-- -------------------------------------------------------------------------------------------------
-- set_food_prefs: replaces the caller's whole selection in one transaction
-- (select all, reset, kit load, restore). Any error (too many items, bad id, bad status) rolls back
-- the delete too, so the old rows stay.
-- security definer because clients have no write privilege on food_prefs; the user id comes only from
-- auth.uid(), never from a parameter, so it cannot touch another user's rows.
-- -------------------------------------------------------------------------------------------------

create function public.set_food_prefs(p_foods jsonb, p_seasonings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  -- data/ has about 100 ids in total; a generous cap against abuse
  max_items constant int := 500;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_foods), '') <> 'object'
     or coalesce(jsonb_typeof(p_seasonings), '') <> 'object' then
    raise exception 'selection must be two objects' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_foods))
     + (select count(*) from jsonb_object_keys(p_seasonings)) > max_items then
    raise exception 'too many items' using errcode = '22023';
  end if;

  delete from public.food_prefs where user_id = uid;

  insert into public.food_prefs (user_id, item_id, kind, status)
  select uid, key, 'food', value #>> '{}' from jsonb_each(p_foods)
  union all
  select uid, key, 'seasoning', value #>> '{}' from jsonb_each(p_seasonings);
  -- item_id length and status values are enforced by the table's check constraints
end
$$;

revoke all on function public.set_food_prefs(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.set_food_prefs(jsonb, jsonb) to authenticated;

-- -------------------------------------------------------------------------------------------------
-- Privileges. Start from nothing (Supabase's default privileges grant a lot, TRUNCATE included, and
-- TRUNCATE ignores RLS), then grant only what the app uses. service_role keeps its own access.
-- -------------------------------------------------------------------------------------------------

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.food_prefs from anon, authenticated;
revoke all on table public.ingredient_kits from anon, authenticated;
revoke all on table public.saved_combos from anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select on table public.food_prefs to authenticated;
grant select, insert, update, delete on table public.ingredient_kits to authenticated;
grant select, insert, delete on table public.saved_combos to authenticated;

-- -------------------------------------------------------------------------------------------------
-- Row level security. (select auth.uid()) is evaluated once per statement instead of once per row.
-- with check on update also blocks moving a row to another user (changing user_id or profiles.id).
-- -------------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.food_prefs enable row level security;
alter table public.ingredient_kits enable row level security;
alter table public.saved_combos enable row level security;

-- profiles
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_delete_own on public.profiles
  for delete to authenticated using ((select auth.uid()) = id);

-- food_prefs: read only (writes go through set_food_prefs)
create policy food_prefs_select_own on public.food_prefs
  for select to authenticated using ((select auth.uid()) = user_id);

-- ingredient_kits
create policy ingredient_kits_select_own on public.ingredient_kits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy ingredient_kits_insert_own on public.ingredient_kits
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy ingredient_kits_update_own on public.ingredient_kits
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ingredient_kits_delete_own on public.ingredient_kits
  for delete to authenticated using ((select auth.uid()) = user_id);

-- saved_combos (no update: a snapshot is saved or deleted, never edited)
create policy saved_combos_select_own on public.saved_combos
  for select to authenticated using ((select auth.uid()) = user_id);
create policy saved_combos_insert_own on public.saved_combos
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy saved_combos_delete_own on public.saved_combos
  for delete to authenticated using ((select auth.uid()) = user_id);

commit;
