// Server component for the home page: the login form for a visitor, the start/continue links for a user.
// It reads cookies, so the page puts it behind <Suspense> (Cache Components).
import { connection } from 'next/server';
import { HomeActions } from '@/components/HomeActions';
import { createClient } from '@/lib/supabase/server';
import { LoginForm } from './LoginForm';

export async function HomeAuth() {
  // getClaims() reads the clock (token expiry). Wait for a real request first so that never happens
  // while Next.js prerenders or prefetches the page ("unstable value Date.now()").
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ? <HomeActions /> : <LoginForm />;
}
