// Reads and writes the day plans of the signed-in user (table day_plans). Plain calls, no cache or queue: the
// screens show the result of the call. Every query names `user_id`; RLS is the second lock, not the only one.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dayPlanDataSchema,
  isValidDateText,
  savedDayPlansFromRows,
  type DayPlanData,
  type SavedDayPlan,
} from '@/lib/plan/dayPlans';

const TABLE = 'day_plans';

const toError = (e: { message?: string } | Error): Error =>
  e instanceof Error ? e : new Error(e.message ?? 'day plans request failed');

/** The user's day plans, newest date first. Rejects when the request fails. */
export async function listDayPlans(
  client: SupabaseClient,
  uid: string,
): Promise<SavedDayPlan[]> {
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('user_id', uid)
    .order('date', { ascending: false });
  if (error) throw toError(error);
  return savedDayPlansFromRows(data);
}

/** Saves the plan for `date`; a plan already saved for that date is replaced, other dates are not touched. */
export async function saveDayPlan(
  client: SupabaseClient,
  uid: string,
  date: string,
  plan: DayPlanData,
): Promise<void> {
  if (!isValidDateText(date)) throw new Error('invalid date');
  dayPlanDataSchema.parse(plan);
  const { error } = await client
    .from(TABLE)
    .upsert({ user_id: uid, date, plan }, { onConflict: 'user_id,date' });
  if (error) throw toError(error);
}

/** Deletes the plan of that date (only that one). */
export async function deleteDayPlan(
  client: SupabaseClient,
  uid: string,
  date: string,
): Promise<void> {
  const { error } = await client
    .from(TABLE)
    .delete()
    .eq('user_id', uid)
    .eq('date', date);
  if (error) throw toError(error);
}
