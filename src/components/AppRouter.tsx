import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Router, UNSAFE_createHashHistory as createHashHistory, type Location, type NavigationType } from 'react-router-dom';

interface RouterState {
  action: NavigationType;
  location: Location;
}

/** where each page was scrolled to when it was left, by history entry */
const scrolled = new Map<string, number>();

export const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The hash router, with two things added so moving between pages feels calm:
 *  - the browser animates the old page into the new one (View Transitions; on a browser without
 *    them, the new page simply fades in, see styles.css), and
 *  - a new page opens at the top, while going back finds the page where it was left.
 */
export function AppRouter({ children }: { children: ReactNode }) {
  const historyRef = useRef<ReturnType<typeof createHashHistory> | null>(null);
  historyRef.current ??= createHashHistory({ v5Compat: true });
  const history = historyRef.current;
  const [state, setState] = useState<RouterState>({ action: history.action, location: history.location });
  const current = useRef(state);
  current.current = state;

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    if (!document.startViewTransition) document.documentElement.classList.add('no-vt');
    return history.listen((update) => {
      const leaving = current.current.location;
      scrolled.set(leaving.key, window.scrollY);
      const apply = () => flushSync(() => setState(update));
      // the same page with another ?search (the home search opening) animates itself
      const samePage = update.location.pathname === leaving.pathname;
      if (samePage || !document.startViewTransition || reduceMotion() || document.visibilityState !== 'visible') {
        apply();
        return;
      }
      document.documentElement.dataset.nav = update.action === 'POP' ? 'back' : 'forward';
      document.startViewTransition(apply);
    });
  }, [history]);

  useLayoutEffect(() => {
    const { action, location } = state;
    const target = action === 'POP' ? (scrolled.get(location.key) ?? 0) : 0;
    window.scrollTo({ top: target, behavior: 'instant' });
    if (!target) return;
    // a page that draws its list a moment later isn't tall enough yet: keep trying briefly,
    // unless the shopkeeper starts scrolling first
    let tries = 0;
    let frame = 0;
    const stop = () => cancelAnimationFrame(frame);
    const again = () => {
      if (Math.abs(window.scrollY - target) < 2 || ++tries > 40) return;
      window.scrollTo({ top: target, behavior: 'instant' });
      frame = requestAnimationFrame(again);
    };
    frame = requestAnimationFrame(again);
    window.addEventListener('touchstart', stop, { once: true, passive: true });
    window.addEventListener('wheel', stop, { once: true, passive: true });
    return () => {
      stop();
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('wheel', stop);
    };
  }, [state]);

  return (
    <Router location={state.location} navigationType={state.action} navigator={history}>
      {children}
    </Router>
  );
}
