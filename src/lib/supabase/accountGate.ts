// When may a screen show its content? One pure rule shared by every screen that used useHydrated().
// A signed-out visitor has nothing to load: the home page (login form) is ready at once, so it can never sit on
// "불러오는 중…". A signed-in user waits for the account data, but never longer than ACCOUNT_LOAD_TIMEOUT_MS.
import { ACCOUNT_LOAD_TIMEOUT_MS } from './syncConstants';

export type SessionState = 'unknown' | 'signed-out' | 'signed-in';
export type AccountPhase = 'idle' | 'loading' | 'ready' | 'error';
/** wait = show "불러오는 중…", ready = show the screen, readonly = show it without editing, with a retry notice. */
export type Gate = 'wait' | 'ready' | 'readonly';

export function gateFor(input: {
  session: SessionState;
  phase: AccountPhase;
  /** How long this screen has been waiting (ms). */
  waitedMs: number;
}): Gate {
  const { session, phase, waitedMs } = input;
  if (session === 'signed-out') return 'ready';
  if (session === 'signed-in' && phase === 'ready') return 'ready';
  if (session === 'signed-in' && phase === 'error') return 'readonly';
  // session not known yet, or signed in and the data is still on its way
  return waitedMs >= ACCOUNT_LOAD_TIMEOUT_MS ? 'readonly' : 'wait';
}
