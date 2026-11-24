-- Phase 6: gives back one counted AI call when the failure is not the user's (upstream 429, timeout, HTTP error,
-- missing key). Called only by the server (service_role), after ai_try_consume counted the call.
-- Same per-day advisory lock as ai_try_consume, so a refund and a count of the same day never interleave,
-- and the count never goes below zero.

begin;

create function public.ai_refund(p_user uuid, p_day date)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('ai_usage_' || p_day::text));
  update public.ai_usage u
    set count = u.count - 1
    where u.user_id = p_user and u.day = p_day and u.count > 0;
end
$$;

revoke all on function public.ai_refund(uuid, date) from public, anon, authenticated;
grant execute on function public.ai_refund(uuid, date) to service_role;

commit;
