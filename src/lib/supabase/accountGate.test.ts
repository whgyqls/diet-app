import { describe, expect, it } from 'vitest';
import { gateFor, type AccountPhase, type SessionState } from './accountGate';
import { ACCOUNT_LOAD_TIMEOUT_MS } from './syncConstants';

const PHASES: AccountPhase[] = ['idle', 'loading', 'ready', 'error'];
const SESSIONS: SessionState[] = ['unknown', 'signed-out', 'signed-in'];

describe('gateFor', () => {
  it('a signed-out visitor is ready at once, whatever the load phase and however long it took', () => {
    for (const phase of PHASES)
      for (const waitedMs of [
        0,
        1,
        ACCOUNT_LOAD_TIMEOUT_MS,
        10 * ACCOUNT_LOAD_TIMEOUT_MS,
      ])
        expect(
          gateFor({ session: 'signed-out', phase, waitedMs }),
          `${phase} ${waitedMs}`,
        ).toBe('ready');
  });

  it('a signed-in user is ready when the account data is loaded', () => {
    expect(gateFor({ session: 'signed-in', phase: 'ready', waitedMs: 0 })).toBe(
      'ready',
    );
  });

  it('a signed-in user waits while the data is not loaded yet', () => {
    expect(gateFor({ session: 'signed-in', phase: 'idle', waitedMs: 0 })).toBe(
      'wait',
    );
    expect(
      gateFor({ session: 'signed-in', phase: 'loading', waitedMs: 100 }),
    ).toBe('wait');
  });

  it('a load error gives the read-only screen at once', () => {
    expect(gateFor({ session: 'signed-in', phase: 'error', waitedMs: 0 })).toBe(
      'readonly',
    );
  });

  it('an unknown session waits, until the timeout', () => {
    expect(gateFor({ session: 'unknown', phase: 'idle', waitedMs: 0 })).toBe(
      'wait',
    );
    expect(
      gateFor({
        session: 'unknown',
        phase: 'idle',
        waitedMs: ACCOUNT_LOAD_TIMEOUT_MS - 1,
      }),
    ).toBe('wait');
    expect(
      gateFor({
        session: 'unknown',
        phase: 'idle',
        waitedMs: ACCOUNT_LOAD_TIMEOUT_MS,
      }),
    ).toBe('readonly');
  });

  it('a load that takes too long ends in the read-only screen (boundary)', () => {
    expect(
      gateFor({
        session: 'signed-in',
        phase: 'loading',
        waitedMs: ACCOUNT_LOAD_TIMEOUT_MS - 1,
      }),
    ).toBe('wait');
    expect(
      gateFor({
        session: 'signed-in',
        phase: 'loading',
        waitedMs: ACCOUNT_LOAD_TIMEOUT_MS,
      }),
    ).toBe('readonly');
  });

  it('never waits for ever: after the timeout no combination is "wait"', () => {
    for (const session of SESSIONS)
      for (const phase of PHASES)
        expect(
          gateFor({ session, phase, waitedMs: ACCOUNT_LOAD_TIMEOUT_MS }),
          `${session} ${phase}`,
        ).not.toBe('wait');
  });

  it('the timeout is a positive number of milliseconds', () => {
    expect(ACCOUNT_LOAD_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
