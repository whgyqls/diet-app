// Supabase client for the browser (client components). Session lives in cookies so the server can read it.
import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseEnv } from './config';

export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
