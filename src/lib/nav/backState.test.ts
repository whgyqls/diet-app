import { describe, expect, it } from 'vitest';
import { markPopped, newNavState, previousPath, recordPath } from './backState';

describe('backState', () => {
  it('knows no previous screen at the start (a screen opened directly)', () => {
    const s = newNavState();
    recordPath(s, '/select');
    expect(previousPath(s)).toBeNull();
  });
  it('remembers the screen a link moved from', () => {
    const s = newNavState();
    recordPath(s, '/plan');
    recordPath(s, '/select');
    expect(previousPath(s)).toBe('/plan');
    recordPath(s, '/saved');
    expect(previousPath(s)).toBe('/select');
  });
  it('the same path again changes nothing (re-renders, Strict Mode)', () => {
    const s = newNavState();
    recordPath(s, '/plan');
    recordPath(s, '/select');
    recordPath(s, '/select');
    expect(previousPath(s)).toBe('/plan');
  });
  it('forgets after a back or forward move, so two screens never send each other back and forth', () => {
    const s = newNavState();
    recordPath(s, '/plan');
    recordPath(s, '/select');
    markPopped(s); // router.back() or the browser button
    recordPath(s, '/plan');
    expect(previousPath(s)).toBeNull();
    // the next link move remembers again
    recordPath(s, '/saved');
    expect(previousPath(s)).toBe('/plan');
  });
  it('a popstate that does not change the path does not leave the flag behind', () => {
    const s = newNavState();
    recordPath(s, '/plan');
    markPopped(s);
    recordPath(s, '/plan'); // same path: nothing happens, the flag stays for the real change
    recordPath(s, '/select');
    expect(previousPath(s)).toBeNull();
  });
});
