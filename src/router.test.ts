import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { parseRoute, setNavigationGuard, useRoute, type NavigationGuard, type PendingNavigation } from './router';

let link: HTMLAnchorElement;
let unregister: (() => void) | null = null;

const click = (init: MouseEventInit = {}, type = 'click') => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  link.dispatchEvent(e);
  return e;
};

// jsdom delivers hashchange asynchronously: let every pending one arrive before the next test starts.
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(async () => {
  window.location.hash = '';
  await settle();
  link = document.createElement('a');
  link.setAttribute('href', '#/studio');
  document.body.append(link);
});

afterEach(async () => {
  await settle();
  unregister?.();
  unregister = null;
  link.remove();
});

const guardWith = (decision: 'allow' | 'hold') => {
  const seen: PendingNavigation[] = [];
  const guard: NavigationGuard = { check: (nav) => (seen.push(nav), decision) };
  unregister = setNavigationGuard(guard);
  return seen;
};

describe('navigation guard', () => {
  it('leaves links alone when no page registered a guard', () => {
    renderHook(() => useRoute());
    expect(click().defaultPrevented).toBe(false);
  });

  it('a held link click is cancelled, the route does not change, and proceed() completes it', async () => {
    const { result } = renderHook(() => useRoute());
    const seen = guardWith('hold');
    expect(click().defaultPrevented).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ target: '#/studio', newTab: false });
    expect(window.location.hash).toBe('');
    expect(result.current.name).toBe('home');
    act(() => seen[0]!.proceed());
    await waitFor(() => expect(result.current.name).toBe('studio'));
    expect(window.location.hash).toBe('#/studio');
    expect(seen).toHaveLength(1); // proceed() does not ask the guard again
  });

  it('an allowed link click is left to the browser, which navigates; the guard is asked again only for the hash change', async () => {
    const { result } = renderHook(() => useRoute());
    const seen = guardWith('allow');
    expect(click().defaultPrevented).toBe(false); // jsdom performs the link's default action: location.hash = '#/studio'
    await waitFor(() => expect(result.current.name).toBe('studio'));
    expect(seen.map((n) => n.target)).toEqual(['#/studio', '#/studio']);
  });
  it('Ctrl-click and middle-click are reported as new-tab requests; proceed() does nothing for them', () => {
    renderHook(() => useRoute());
    const seen = guardWith('hold');
    expect(click({ ctrlKey: true }).defaultPrevented).toBe(true);
    expect(click({ button: 1 }, 'auxclick').defaultPrevented).toBe(true);
    expect(seen.map((n) => n.newTab)).toEqual([true, true]);
    act(() => seen.forEach((n) => n.proceed()));
    expect(window.location.hash).toBe('');
  });

  it('a modified click that the guard allows keeps the browser default (new tab)', () => {
    renderHook(() => useRoute());
    guardWith('allow');
    expect(click({ ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('a hash change (browser Back, typed address) that is held keeps the displayed route', async () => {
    const { result } = renderHook(() => useRoute());
    const seen = guardWith('hold');
    act(() => {
      window.location.hash = '#/privacy';
    });
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.target).toBe('#/privacy');
    expect(result.current.name).toBe('home');
  });

  it('parseRoute still understands every route', () => {
    expect(parseRoute('#/edit/a%20b')).toEqual({ name: 'edit', id: 'a b' });
    expect(parseRoute('#/preview/x')).toEqual({ name: 'preview', id: 'x' });
    expect(parseRoute('#/studio/new')).toEqual({ name: 'studio', openNew: true });
    expect(parseRoute('')).toEqual({ name: 'home' });
  });
});