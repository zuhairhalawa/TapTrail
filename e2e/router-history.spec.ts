import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, test, type Page } from '@playwright/test';

/**
 * Router-only regression on REAL browser history (no React app, no storage): the guard approves a held
 * navigation immediately, i.e. BEFORE the browser has finished the rollback traversal the router started.
 * The bundle is the repository's own src/router.ts, built here with the locked Vite.
 */
interface Nav {
  target: string;
  proceed: () => void;
}
interface TT {
  __tt: { R: { setNavigationGuard: (g: { check: (n: Nav) => 'allow' | 'hold' }) => () => void }; log: string[] };
  __held: string[];
  __nav: Nav;
}
const ORIGIN = 'http://router.test';
let bundle = '';

test.beforeAll(async () => {
  const dir = fileURLToPath(new URL('./.tmp/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, 'router-entry.ts');
  writeFileSync(
    entry,
    `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import * as R from '../../src/router';
const log: string[] = [];
function App() { const r = R.useRoute(); log.push(r.name); return null; }
createRoot(document.getElementById('root')!).render(createElement(App));
(window as unknown as Record<string, unknown>).__tt = { R, log };
`,
    'utf8',
  );
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    root: fileURLToPath(new URL('..', import.meta.url)),
    build: { write: false, lib: { entry, formats: ['iife'], name: 'TT', fileName: 'tt' }, minify: false },
  });
  const o = (Array.isArray(out) ? out[0] : out) as { output: { code: string }[] };
  bundle = o.output[0]!.code;
});

const displayedRoute = (page: Page) => page.evaluate(() => { const l = (window as unknown as TT).__tt?.log ?? []; return l[l.length - 1]; });

async function open(page: Page) {
  await page.route(`${ORIGIN}/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }));
  await page.goto(`${ORIGIN}/#/a`);
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => displayedRoute(page)).toBe('home'); // React has rendered and the router is subscribed
  // Real history: [#/a, #/b, #/c], displayed #/c.
  for (const h of ['#/privacy', '#/studio']) {
    await page.evaluate((x) => { location.hash = x; }, h);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(h);
    await expect.poll(() => displayedRoute(page)).toBe(h === '#/studio' ? 'studio' : 'privacy');
  }
}


/** Install a guard; `approve` says when a held request is approved: 'microtask' = before the rollback can finish. */
const install = (page: Page, mode: 'microtask' | 'never' | 'timer10') =>
  page.evaluate((m) => {
    const w = window as unknown as TT;
    w.__held = [];
    w.__tt.R.setNavigationGuard({
      check: (nav: Nav) => {
        w.__held.push(nav.target);
        if (m === 'microtask') queueMicrotask(() => nav.proceed());
        else if (m === 'timer10') setTimeout(() => nav.proceed(), 10);
        else w.__nav = nav;
        return 'hold';
      },
    });
  }, mode);


test.describe('router: approval that arrives before the rollback traversal has finished', () => {
  for (const mode of ['microtask', 'timer10'] as const) {
    test(`Back approved ${mode === 'microtask' ? 'immediately' : 'after 10 ms'} reaches the previous route (real history)`, async ({ page }) => {
      await open(page);
      expect(await displayedRoute(page)).toBe('studio');
      await install(page, mode);
      await page.evaluate(() => history.back());
      await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/privacy');
      await expect.poll(() => displayedRoute(page)).toBe('privacy');
      expect(await page.evaluate(() => (window as unknown as TT).__held)).toEqual(['#/privacy']);
    });
  }

  test('Forward approved immediately reaches the next route', async ({ page }) => {
    await open(page);
    await page.evaluate(() => history.back()); // unguarded: back to #/privacy
    await expect.poll(() => displayedRoute(page)).toBe('privacy');
    await install(page, 'microtask');
    await page.evaluate(() => history.forward());
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/studio');
    await expect.poll(() => displayedRoute(page)).toBe('studio');
  });

  test('a request that is never approved keeps the URL and the displayed route on the page', async ({ page }) => {
    await open(page);
    await install(page, 'never');
    await page.evaluate(() => history.back());
    await expect.poll(() => page.evaluate(() => (window as unknown as TT).__held.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/studio');
    expect(await displayedRoute(page)).toBe('studio');
  });

  test('approval after the rollback has finished still works (slow approval)', async ({ page }) => {
    await open(page);
    await install(page, 'never');
    await page.evaluate(() => history.back());
    await expect.poll(() => page.evaluate(() => (window as unknown as TT).__held.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/studio');
    await page.evaluate(() => (window as unknown as TT).__nav.proceed());
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/privacy');
    await expect.poll(() => displayedRoute(page)).toBe('privacy');
  });
});
