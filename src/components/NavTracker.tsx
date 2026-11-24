'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { markPopped, nav, recordPath } from '@/lib/nav/backState';

/** In the root layout, on every screen: records the screen path and back/forward moves for the back button. */
export function NavTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const onPop = () => markPopped(nav);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => recordPath(nav, pathname), [pathname]);
  return null;
}
