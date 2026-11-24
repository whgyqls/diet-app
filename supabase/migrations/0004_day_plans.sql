-- Phase 6a: one saved day plan per user and date (the foods eaten at each meal of that day, as a snapshot).
-- Same rules as 0001_init.sql: RLS on with owner-only policies (auth.uid() = user_id), privileges revoked and
-- granted explicitly (this project does not grant API access to new tables automatically), rows go with the
-- account (ON DELETE CASCADE). Saving a date again replaces that date's plan, so the owner may also update.
-- unique (user_id, date) is also the index that lists a user's dates, newest first.

begin;

create table public.day_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null check (date between date '2020-01-01' and date '2099-12-31'),
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) < 32768),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.day_plans enable row level security;

create policy day_plans_select_own on public.day_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy day_plans_insert_own on public.day_plans
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy day_plans_update_own on public.day_plans
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy day_plans_delete_own on public.day_plans
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Start from nothing (Supabase's default privileges may grant a lot, TRUNCATE included, and TRUNCATE ignores
-- RLS), then grant only what the app uses. service_role (server only: account deletion, test seeding) gets the
-- same four commands as on the other tables; it bypasses RLS, so it is never used from the browser.
revoke all on table public.day_plans from anon, authenticated, service_role;
grant select, insert, update, delete on table public.day_plans to authenticated;
grant select, insert, update, delete on table public.day_plans to service_role;

commit;
