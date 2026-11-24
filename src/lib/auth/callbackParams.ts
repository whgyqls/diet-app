// What /auth/callback does with its query string. Pure, so the decisions can be tested without Next.js.
// Two ways a magic link arrives:
//  - token_hash + type=email: the Magic Link email template points here (works in any browser)
//  - code: the default template (PKCE code exchange, only in the browser that asked for the link), and also the
//    way a Google sign-in comes back (Supabase redirects to redirectTo with ?code=...)
import { safeNextPath } from './safeNextPath';

export type CallbackAction =
  | { kind: 'verify_otp'; tokenHash: string; next: string }
  | { kind: 'exchange_code'; code: string; next: string }
  /** The provider (Google) sent the person back with ?error=... (they said no, or it failed). */
  | { kind: 'provider_error' }
  | { kind: 'invalid' };

/** The only link type this app sends (a magic link). Everything else is refused. */
export const CALLBACK_OTP_TYPE = 'email';

export function resolveCallback(params: URLSearchParams): CallbackAction {
  const next = safeNextPath(params.get('next'));
  const tokenHash = params.get('token_hash');
  if (tokenHash) {
    // A token_hash with any other type (recovery, invite, ...) is not something we send: refuse it.
    return params.get('type') === CALLBACK_OTP_TYPE
      ? { kind: 'verify_otp', tokenHash, next }
      : { kind: 'invalid' };
  }
  const code = params.get('code');
  if (code) return { kind: 'exchange_code', code, next };
  if (params.has('error')) return { kind: 'provider_error' };
  return { kind: 'invalid' };
}
