-- Phase 6: AI explanation. Two tables and one function, all used only by the server (service_role):
--   ai_explanations: cache shared by everyone. No user data: the key is a hash of the normalized combo
--                    (food ids, grams, totals, goal kind) + model + prompt version.
--   ai_usage:        calls per user per UTC day. Rows go with the account (ON DELETE CASCADE).
--   ai_try_consume:  counts one call only if both the user's and the whole site's daily limit allow it.
-- Same rules as 0001_init.sql: RLS on, no policy (so anon/authenticated can do nothing), privileges revoked
-- and granted explicitly (this project does not grant API access to new objects automatically).

begin;

create table public.ai_explanations (
  combo_hash text primary key check (char_length(combo_hash) = 64),
  model text not null check (char_length(model) between 1 and 100),
  text text not null check (char_length(text) between 1 and 400),
  created_at timestamptz not null default now()
);

create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count int not null default 0 check (count >= 0),
  primary key (user_id, day)
);

alter table public.ai_explanations enable row level security;
alter table public.ai_usage enable row level security;
-- no policies on purpose: only the service role (which bypasses RLS) reads and writes these tables

revoke all on table public.ai_explanations from anon, authenticated, service_role;
revoke all on table public.ai_usage from anon, authenticated, service_role;
grant select, insert on table public.ai_explanations to service_role;
grant select, insert, update on table public.ai_usage to service_role;

-- Atomic: the advisory lock makes concurrent calls of the same UTC day wait for each other, so the limits
-- cannot be overshot. Returns true when the call was counted, false when a limit is reached.
create function public.ai_try_consume(
  p_user uuid,
  p_day date,
  p_user_limit int,
  p_site_limit int
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  site_total int;
  user_total int;
begin
  perform pg_advisory_xact_lock(hashtext('ai_usage_' || p_day::text));
  select coalesce(sum(u.count), 0) into site_total from public.ai_usage u where u.day = p_day;
  select coalesce(sum(u.count), 0) into user_total
    from public.ai_usage u where u.user_id = p_user and u.day = p_day;
  if site_total >= p_site_limit or user_total >= p_user_limit then
    return false;
  end if;
  insert into public.ai_usage as t (user_id, day, count) values (p_user, p_day, 1)
    on conflict (user_id, day) do update set count = t.count + 1;
  return true;
end
$$;

revoke all on function public.ai_try_consume(uuid, date, int, int) from public, anon, authenticated;
grant execute on function public.ai_try_consume(uuid, date, int, int) to service_role;

commit;
