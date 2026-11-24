// Where the magic link and the Google sign-in land. Shapes (see src/lib/auth/callbackParams.ts):
//  - ?token_hash=...&type=email  (Magic Link email template points here)
//  - ?code=...                   (default template, PKCE code exchange)
// On success: session cookies are set and the user goes to `next` (an internal path, default /select).
// On failure: back to the home page with ?auth_error=1 (?auth_error=oauth when Google sent the person back with an error).
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { CALLBACK_OTP_TYPE, resolveCallback } from '@/lib/auth/callbackParams';
import { getSupabaseEnv } from '@/lib/supabase/config';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const failure = () =>
    NextResponse.redirect(new URL('/?auth_error=1', origin));

  const action = resolveCallback(searchParams);
  if (action.kind === 'provider_error')
    return NextResponse.redirect(new URL('/?auth_error=oauth', origin));
  if (action.kind === 'invalid') return failure();

  // Built first so the session cookies can be written straight onto it.
  const success = NextResponse.redirect(new URL(action.next, origin));
  const { url, anonKey } = getSupabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value, options }) =>
          success.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([k, v]) => success.headers.set(k, v));
      },
    },
  });

  const { error } =
    action.kind === 'verify_otp'
      ? await supabase.auth.verifyOtp({
          type: CALLBACK_OTP_TYPE,
          token_hash: action.tokenHash,
        })
      : await supabase.auth.exchangeCodeForSession(action.code);
  return error ? failure() : success;
}
