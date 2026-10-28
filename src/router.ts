import { useEffect, useState } from 'react';

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

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}