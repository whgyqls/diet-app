// Which pages need a login. The proxy only does an optimistic redirect with this; the data itself is
// protected by RLS (Next.js docs: the proxy is not a full authorization layer).

export const PROTECTED_PREFIXES = [
  '/onboarding',
  '/select',
  '/plan',
  '/saved',
  '/settings',
] as const;

/** Decoded, lower case, one slash between segments, no trailing slash: what the router would match. */
function normalize(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep the raw path: it is checked as is
  }
  p = p
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function isProtectedPath(pathname: string): boolean {
  const p = normalize(pathname);
  return PROTECTED_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(`${prefix}/`),
  );
}

/** Where to send the request instead, or null to let it through. */
export function loginRedirectFor(
  pathname: string,
  signedIn: boolean,
): string | null {
  return !signedIn && isProtectedPath(pathname) ? '/' : null;
}
