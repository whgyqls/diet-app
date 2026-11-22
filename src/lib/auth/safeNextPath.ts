// Where to send the user after login. `next` comes from a URL, so it is untrusted: only an internal path
// ("/" + something, same origin) is allowed. Anything else (other host, scheme, "//", backslash, encoded
// tricks, control characters) falls back to the default.

/** Where a login without a (valid) `next` lands (decided in the Phase 5 plan). */
export const DEFAULT_NEXT_PATH = '/select';

const UNSAFE_CHARS = /[\\\u0000-\u001f\u007f\s]/;
const BASE = 'http://internal.invalid';

function isInternal(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (UNSAFE_CHARS.test(path)) return false;
  try {
    return new URL(path, BASE).origin === BASE;
  } catch {
    return false;
  }
}

export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw === '') return DEFAULT_NEXT_PATH;
  if (!isInternal(raw)) return DEFAULT_NEXT_PATH;
  // Also check what a decoder would see (up to two rounds), so "%2F%2Fevil.com" or "/%5Cevil.com" cannot pass.
  let decoded = raw;
  for (let i = 0; i < 2; i += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return DEFAULT_NEXT_PATH;
    }
    if (!isInternal(decoded)) return DEFAULT_NEXT_PATH;
  }
  return raw;
}
