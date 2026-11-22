// Public Supabase settings (safe for the browser: the anon key only works through RLS).
// Each NEXT_PUBLIC_ variable must be written out in full below, or Next.js does not put it in the client bundle.

export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error(
      'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local',
    );
  return { url, anonKey };
}
