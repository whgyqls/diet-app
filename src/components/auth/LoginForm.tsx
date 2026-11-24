'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LOGIN_MESSAGES,
  RESEND_COOLDOWN_SECONDS,
  authErrorMessage,
  looksLikeEmail,
  loginErrorMessage,
} from '@/lib/auth/loginMessages';
import { createClient } from '@/lib/supabase/client';

type Phase = 'idle' | 'sending' | 'sent';

/** Email magic link login. The link comes back through /auth/callback. */
export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(
    authErrorMessage(params.get('auth_error')),
  );
  const [googleBusy, setGoogleBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === 'sending' || cooldown > 0) return;
    if (!looksLikeEmail(email)) {
      setError(LOGIN_MESSAGES.invalidEmail);
      return;
    }
    setPhase('sending');
    setError(null);
    try {
      const { error: authError } = await createClient().auth.signInWithOtp({
        email: email.trim(),
        // Must match an entry of the Redirect URLs list in the Supabase dashboard exactly.
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (authError) {
        setPhase('idle');
        setError(loginErrorMessage(authError));
        return;
      }
      setPhase('sent');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setPhase('idle');
      setError(LOGIN_MESSAGES.generic);
    }
  }

  async function google() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    try {
      const { error: authError } = await createClient().auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Same callback as the magic link; must be in the Redirect URLs list of the Supabase dashboard.
          redirectTo: `${window.location.origin}/auth/callback`,
          // always let the person pick the account (a shared browser may be signed in to another one)
          queryParams: { prompt: 'select_account' },
        },
      });
      // On success the browser is already on its way to Google.
      if (authError) {
        setGoogleBusy(false);
        setError(LOGIN_MESSAGES.oauthStartFailed);
      }
    } catch {
      setGoogleBusy(false);
      setError(LOGIN_MESSAGES.oauthStartFailed);
    }
  }

  const waiting = cooldown > 0;
  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-3" noValidate>
      <button
        type="button"
        onClick={() => void google()}
        disabled={googleBusy}
        className="flex min-h-12 items-center justify-center rounded-lg border border-neutral-300 font-semibold disabled:opacity-60 dark:border-neutral-600"
      >
        {googleBusy ? 'Google로 이동 중…' : 'Google로 계속하기'}
      </button>
      <p
        aria-hidden="true"
        className="text-center text-xs text-neutral-600 dark:text-neutral-400"
      >
        또는 이메일로
      </p>
      <label htmlFor="login-email" className="text-sm font-medium">
        이메일
      </label>
      <input
        id="login-email"
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="min-h-12 rounded-lg border border-neutral-300 bg-background px-3 dark:border-neutral-600"
        placeholder="name@example.com"
      />
      <button
        type="submit"
        disabled={phase === 'sending' || waiting}
        className="flex min-h-12 items-center justify-center rounded-lg bg-emerald-600 font-semibold text-white disabled:opacity-60"
      >
        {phase === 'sending'
          ? '보내는 중…'
          : waiting
            ? `다시 받기 (${cooldown}초)`
            : phase === 'sent'
              ? '로그인 링크 다시 받기'
              : '로그인 링크 받기'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {phase === 'sent' && !error && (
        <p role="status" className="text-sm">
          {LOGIN_MESSAGES.sent}
        </p>
      )}
      <p className="text-center text-sm text-neutral-700 dark:text-neutral-300">
        <Link href="/privacy" className="underline">
          개인정보 안내
        </Link>
      </p>
    </form>
  );
}
