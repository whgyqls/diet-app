// localStorage that never throws (private mode, blocked site data, SSR). Shared by the app store and saved combos.

export type StateStorage = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
};

/** Safe localStorage: returns a no-op storage when it is unavailable (private mode, SSR). */
export function safeLocalStorage(): StateStorage {
  const noop: StateStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  if (typeof window === 'undefined') return noop;
  return {
    getItem: (k) => {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {}
    },
    removeItem: (k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {}
    },
  };
}
