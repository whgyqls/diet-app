// What the screen shows about "이전 기록 불러오기": the busy mark, the result line and the undo window.
// Kept outside React because the screen unmounts while the account data loads again after a restore (the
// "불러오는 중…" gate), and the result line and the undo toast must survive that. Not account data: nothing here
// is saved anywhere.
import { RESTORE_UNDO_MS } from '@/lib/supabase/syncConstants';

export type RestoreUiState = {
  busy: boolean;
  message: string | null;
  /** When the one-go restore finished (ms); the undo is offered for RESTORE_UNDO_MS from then. */
  undoSince: number | null;
};

const IDLE: RestoreUiState = { busy: false, message: null, undoSince: null };
let state: RestoreUiState = IDLE;
let expiry: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export const restoreUi = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  set(patch: Partial<RestoreUiState>) {
    state = { ...state, ...patch };
    if (expiry !== null) clearTimeout(expiry);
    expiry = null;
    if (state.undoSince !== null) {
      // the window closes on its own, however often the screen is rebuilt meanwhile
      const since = state.undoSince;
      expiry = setTimeout(() => {
        expiry = null;
        if (state.undoSince === since) {
          state = { ...state, undoSince: null };
          emit();
        }
      }, RESTORE_UNDO_MS);
    }
    emit();
  },
  reset() {
    this.set({ busy: false, message: null, undoSince: null });
  },
};
