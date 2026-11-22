// Public Supabase settings (safe for the browser: the anon key only works through RLS).
// Each NEXT_PUBLIC_ variable must be written out in full below, or Next.js does not put it in the client bundle.

/**
 * Pure check of the two public settings. The URL must be the project URL without a path
 * (https://<ref>.supabase.co); the REST endpoint (.../rest/v1/) is a common copy mistake and makes
 * every auth and data call fail with "Invalid path specified in request URL".
 */
export function checkSupabaseEnv(
  url: string | undefined,
  anonKey: string | undefined,
): { url: string; anonKey: string } {
  if (!url || !anonKey)
    throw new Error(
      'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local',
    );
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash)
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must be the project URL without a path (https://<ref>.supabase.co), not ...${parsed.pathname}${parsed.search}`,
    );
  return { url: parsed.origin, anonKey };
}

export function getSupabaseEnv(): { url: string; anonKey: string } {
  return checkSupabaseEnv(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
