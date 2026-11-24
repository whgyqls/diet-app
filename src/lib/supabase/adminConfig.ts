// Pure checks for the service-role settings (the env itself is read in admin.ts only, nowhere else).

/** Project ref of a "https://<ref>.supabase.co" URL, or null for another host (self-hosted, local). */
function refOfUrl(url: URL): string | null {
  const m = /^([a-z0-9]+)\.supabase\.(?:co|red)$/i.exec(url.hostname);
  return m ? m[1].toLowerCase() : null;
}

/** The `ref` claim of a legacy JWT service key, or null when the key is not a JWT (e.g. sb_secret_...). */
function refOfKey(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { ref?: unknown };
    return typeof payload.ref === 'string' ? payload.ref.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Returns the trimmed key, or throws. When both the URL and the key name a project, they must be the same one:
 * a key of another project (say production, with the test URL) must never be used. A key that does not say
 * which project it belongs to (new opaque keys) cannot be compared, so it passes.
 */
export function checkAdminEnv(
  url: string,
  serviceKey: string | undefined,
): string {
  const key = serviceKey?.trim();
  if (!key)
    throw new Error(
      'Account deletion is not configured: set SUPABASE_SERVICE_ROLE_KEY (server only)',
    );
  const keyRef = refOfKey(key);
  const urlRef = refOfUrl(new URL(url));
  if (keyRef && urlRef && keyRef !== urlRef)
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY belongs to a different Supabase project than NEXT_PUBLIC_SUPABASE_URL',
    );
  return key;
}
