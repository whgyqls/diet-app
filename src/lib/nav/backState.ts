// Which screen the user really came from, so "← 이전 화면" can go back only when that is known.
// A previous screen is remembered only for a move made inside the app (a link). After a browser back/forward
// (popstate, which also covers router.back()) it is forgotten: nobody can tell where that leads, so the button
// uses the screen's fixed parent instead. That keeps it from looping between two screens and from leaving the app.
export type NavState = {
  current: string | null;
  previous: string | null;
  /** A back/forward move happened since the last path change. */
  popped: boolean;
};

export const newNavState = (): NavState => ({
  current: null,
  previous: null,
  popped: false,
});

/** Called when the pathname changes (and once at start). The same path again changes nothing. */
export function recordPath(s: NavState, path: string): void {
  if (s.current === path) return;
  s.previous = s.popped ? null : s.current;
  s.current = path;
  s.popped = false;
}

/** Called on `popstate`. */
export function markPopped(s: NavState): void {
  s.popped = true;
}

/** The screen the user moved here from inside the app, or null when that is not known. */
export const previousPath = (s: NavState): string | null => s.previous;

/** The one state of the running app (memory only: a reload starts without a previous screen). */
export const nav: NavState = newNavState();
