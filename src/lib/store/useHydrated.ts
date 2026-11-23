'use client';
import { useAccountGate } from '@/lib/account/useAccount';

/**
 * May this screen show its content? False only while the account data is still on its way ("불러오는 중…").
 * A signed-out visitor is ready at once; when the data could not be loaded the screen is shown too (read-only,
 * with a notice from the AccountProvider), so nothing waits for ever. See useAccountGate.
 */
export function useHydrated(): boolean {
  return useAccountGate() !== 'wait';
}
