// Runs before every page request (Next.js 16 "proxy", formerly middleware):
// 1. refreshes the Supabase session cookies when the access token is about to expire,
// 2. sends a signed-out visitor of a protected page to the home page (login).
// The session is judged with getClaims() (signature checked), never with getSession() on cookie values.
// This is an optimistic check only: the data itself is protected by RLS.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { loginRedirectFor } from '@/lib/auth/routes';
import { getSupabaseEnv } from '@/lib/supabase/config';

export async function proxy(request: NextRequest) {
  const { url, anonKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });
  const cookieHeaders: Record<string, string> = {};

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        // Responses that carry auth cookies must never be cached (a CDN could hand them to someone else).
        Object.assign(cookieHeaders, headers);
        Object.entries(cookieHeaders).forEach(([k, v]) =>
          response.headers.set(k, v),
        );
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const target = loginRedirectFor(request.nextUrl.pathname, !!data?.claims);
  if (!target) return response;

  const redirect = NextResponse.redirect(new URL(target, request.url));
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  Object.entries(cookieHeaders).forEach(([k, v]) => redirect.headers.set(k, v));
  return redirect;
}

export const config = {
  // Everything except static files and Next.js internals.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|txt|js|css|woff2?)$).*)',
  ],
};
