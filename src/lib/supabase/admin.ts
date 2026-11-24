// Supabase client with the service-role key. Server only, and the ONLY file that reads
// SUPABASE_SERVICE_ROLE_KEY. The key bypasses RLS, so use it for what a signed-in user cannot do alone
// (deleting the account) and always with an id taken from the verified session, never from the request.
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { checkAdminEnv } from './adminConfig';
import { getSupabaseEnv } from './config';

export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const key = checkAdminEnv(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
