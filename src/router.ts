import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'studio'; openNew: boolean }
  | { name: 'edit'; id: string }
  | { name: 'preview'; id: string }
  | { name: 'privacy' };

/** Hash routing keeps the app working on GitHub Pages without server rewrites. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const parts = path.split('/').filter(Boolean);
  const [head, arg] = parts;
  if (head === 'studio') return { name: 'studio', openNew: arg === 'new' };
  if (head === 'edit' && arg) return { name: 'edit', id: decodeURIComponent(arg) };
  if (head === 'preview' && arg) return { name: 'preview', id: decodeURIComponent(arg) };
  if (head === 'privacy') return { name: 'privacy' };
  return { name: 'home' };
}

export const hrefs = {
  home: '#/',
  studio: '#/studio',
  newGuide: '#/studio/new',
  privacy: '#/privacy',
  edit: (id: string) => `#/edit/${encodeURIComponent(id)}`,
  preview: (id: string) => `#/preview/${encodeURIComponent(id)}`,
};

export function navigate(hash: string): void {
  window.location.hash = hash;
}

// ---------------------------------------------------------------------------------------------
// One navigation decision for every way of leaving the current page (header links, "Back to
// guides", Preview links, browser Back/Forward, typing a new hash). A page that holds unsaved work
// registers a guard; the router asks it before it changes the displayed route. The guard either
// allows the change or takes the request over ("hold") and later calls `proceed()` if the user
// really may leave. Nothing else in the app needs its own per-link check.
// ---------------------------------------------------------------------------------------------

export interface PendingNavigation {
  /** In-app hash target, e.g. `#/studio`. */
  target: string;
  /** True for Ctrl/Cmd/Shift/Alt/middle clicks: the browser would open another tab or window. */
  newTab: boolean;
  /** Complete the navigation (skips the guard). A no-op for `newTab` requests. */
  proceed: () => void;
}

export interface NavigationGuard {
  /** 'allow': carry on normally. 'hold': stay here; the guard decides later whether to call proceed(). */
  check: (nav: PendingNavigation) => 'allow' | 'hold';
}

let guard: NavigationGuard | null = null;

/** Register the page's guard (one at a time). Returns the function that unregisters it. */
export function setNavigationGuard(g: NavigationGuard): () => void {
  guard = g;
  return () => {
    if (guard === g) guard = null;
  };
}

let current: Route | null = null; // the route that is displayed (can lag behind the URL while a guard holds)
const subscribers = new Set<() => void>();
let idx = 0; // position of the displayed entry in this tab's history, stamped into history.state
let bypass: string | null = null; // hash a guard's proceed() is heading to: that one hashchange is not asked about again

// A held request puts the URL back with history.go(-delta). That traversal is asynchronous, and a second
// traversal started before it has finished can be dropped or reordered by the browser. So while the
// rollback is in flight, an approval (proceed) is parked here and runs from the rollback's own hashchange.
let rollingBack = false;
let afterRollback: (() => void) | null = null;

/** Run `go` now, or - if a rollback traversal is still in flight - as soon as that traversal has arrived. */
function whenRollbackDone(go: () => void): void {
  if (rollingBack) afterRollback = go; // the newest approval replaces any parked one
  else go();
}

const sameRoute = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

function commit(): void {
  current = parseRoute(window.location.hash);
  window.scrollTo(0, 0);
  subscribers.forEach((cb) => cb());
}

/** Number of history entries between the displayed entry and the one the URL now points at. */
function arrivalDelta(): number {
  const s = (window.history.state as { ttIdx?: unknown } | null)?.ttIdx;
  if (typeof s === 'number') return s - idx; // Back/Forward onto an entry we stamped earlier
  window.history.replaceState({ ttIdx: idx + 1 }, ''); // a new entry (link click or typed hash)
  return 1;
}

function onHashChange(): void {
  const next = parseRoute(window.location.hash);
  if (bypass !== null) {
    const expected = bypass;
    bypass = null; // single use, whatever happens
    if (window.location.hash === expected) {
      idx += arrivalDelta();
      commit();
      return;
    }
  }
  if (current && sameRoute(next, current)) {
    // e.g. the guard put the URL back: the rollback has arrived, so a parked approval may navigate now
    const parked = afterRollback;
    rollingBack = false;
    afterRollback = null;
    parked?.();
    return;
  }
  // A genuinely new request: whatever was parked for the previous one is stale.
  rollingBack = false;
  afterRollback = null;
  if (guard) {
    const delta = arrivalDelta();
    const target = window.location.hash;
    const decision = guard.check({
      target,
      newTab: false,
      proceed: () =>
        whenRollbackDone(() => {
          bypass = target;
          window.history.go(delta);
        }),
    });
    if (decision === 'hold') {
      rollingBack = delta !== 0;
      window.history.go(-delta); // put the URL back on the page that is still showing
      return;
    }
    idx += delta;
    commit();
    return;
  }
  idx += arrivalDelta();
  commit();
}

const isModified = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

function onLinkClick(e: MouseEvent): void {
  if (!guard || e.defaultPrevented || e.button > 1) return;
  const a = (e.target as Element | null)?.closest?.('a[href^="#/"]');
  if (!a || (a.getAttribute('target') ?? '_self') !== '_self') return;
  const target = a.getAttribute('href') ?? '';
  if (e.type === 'auxclick' && e.button !== 1) return;
  const newTab = isModified(e);
  const proceed = newTab
    ? () => undefined
    : () =>
        whenRollbackDone(() => {
          if (target === window.location.hash) return;
          bypass = target;
          window.location.hash = target;
        });
  const decision = guard.check({ target, newTab, proceed });
  if (decision === 'hold') e.preventDefault(); // on 'allow' the browser's own link handling runs (and the hashchange is checked once more)
}

function attach(): () => void {
  const state = window.history.state as { ttIdx?: unknown } | null;
  if (typeof state?.ttIdx === 'number') idx = state.ttIdx;
  else window.history.replaceState({ ttIdx: idx }, '');
  current = parseRoute(window.location.hash);
  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('click', onLinkClick, true);
  document.addEventListener('auxclick', onLinkClick, true);
  return () => {
    window.removeEventListener('hashchange', onHashChange);
    document.removeEventListener('click', onLinkClick, true);
    document.removeEventListener('auxclick', onLinkClick, true);
  };
}

let detach: (() => void) | null = null;

function subscribe(cb: () => void): () => void {
  if (subscribers.size === 0) detach = attach();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0) {
      detach?.();
      detach = null;
    }
  };
}

function snapshot(): Route {
  current ??= parseRoute(window.location.hash);
  return current;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot);
}
