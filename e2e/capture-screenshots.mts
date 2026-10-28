/*
 * Captures the README screenshots from a RUNNING TapTrail site (default: the public deployment).
 * It drives the real UI: it rasterizes the fictional "Lumen" sample screens, builds a guide from them
 * in the editor, covers the (fictional) name and e-mail, exports, imports on a phone and opens the
 * exported file offline.
 *
 *   node e2e/capture-screenshots.mts [baseUrl]
 */
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drag, exportHtml, exportJson, TMP } from './helpers.ts';

const BASE = (process.argv[2] ?? 'https://zuhairhalawa.github.io/TapTrail/').replace(/\/?$/, '/');
const OUT = resolve(import.meta.dirname, '../docs/screenshots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const settle = (p: import('@playwright/test').Page, ms = 900) => p.waitForTimeout(ms);

// 1. Rasterize the first three Lumen sample screens (and read their instructions and tap areas) from the live demo.
const grab = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await grab.goto(BASE);
const demo = grab.getByTestId('viewer-host');
const screens: { file: string; instruction: string; hot: [number, number, number, number] }[] = [];
for (let i = 0; i < 3; i++) {
  await settle(grab, 500);
  const stage = (await demo.locator('.tt-stage').boundingBox())!;
  const hb = (await demo.locator('.tt-hotspot').boundingBox())!;
  const b64 = await demo.locator('.tt-img').evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 720;
    c.height = 1280;
    c.getContext('2d')!.drawImage(img, 0, 0, 720, 1280);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  const file = resolve(TMP, `lumen-${i + 1}.png`);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  screens.push({
    file,
    instruction: (await demo.locator('.tt-instruction').innerText()).trim(),
    hot: [(hb.x - stage.x) / stage.width, (hb.y - stage.y) / stage.height, hb.width / stage.width, hb.height / stage.height],
  });
  await demo.locator('.tt-hotspot').click();
}
await grab.context().close();

// 2. Desktop: landing, then build the guide in the real editor.
const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
const d = await dctx.newPage();
await d.goto(BASE);
await expect(d.getByRole('heading', { level: 1 })).toBeVisible();
await settle(d, 1800);
await d.screenshot({ path: `${OUT}/landing-desktop.png` });

await d.goto(`${BASE}#/studio/new`);
await d.getByRole('dialog').getByLabel('Guide name').fill('Turn on two-step verification');
await d.getByRole('dialog').getByLabel('Short description (optional)').fill('A walkthrough of the fictional Lumen app');
await d.getByRole('dialog').getByRole('button', { name: 'Create guide' }).click();
await d.getByTestId('file-input').setInputFiles(screens.map((s) => s.file));
await expect(d.getByTestId('step-item')).toHaveCount(3);
for (let i = 0; i < 3; i++) {
  const [x, y, w, h] = screens[i]!.hot;
  await d.getByTestId('step-item').nth(i).click();
  await drag(d, [x, y], [x + w, y + h]);
  await d.getByLabel('What should the reader do?').fill(screens[i]!.instruction);
}
await d.getByTestId('step-item').nth(0).click();
await d.getByTestId('image-stage').evaluate((el) => el.scrollIntoView({ block: 'start' }));
await d.evaluate(() => window.scrollTo(0, 0));
await expect(d.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
await settle(d);
await d.screenshot({ path: `${OUT}/editor-desktop.png` });

// 3. Cover the fictional name and e-mail on step 2.
await d.getByTestId('step-item').nth(1).click();
await d.getByRole('button', { name: 'Cover private info' }).click();
await drag(d, [0.28, 0.335], [0.72, 0.43]);
await expect(d.getByTestId('redaction-box')).toHaveCount(1);
await expect(d.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
await d.evaluate(() => window.scrollTo(0, 0));
await settle(d);
await d.screenshot({ path: `${OUT}/editor-redaction.png` });

// 4. Export, then open the exported file with the network switched off.
const html = await exportHtml(d, 'readme-guide.html');
const json = await exportJson(d, 'readme-guide.taptrail.json');
const openFile = async (viewport: { width: number; height: number }, mobile: boolean) => {
  const ctx = await browser.newContext({ offline: true, viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(html).href);
  await expect(p.locator('.tt-viewer')).toBeVisible();
  return p;
};
const v = await openFile({ width: 1440, height: 900 }, false);
await v.locator('.tt-hotspot').click();
await expect(v.locator('.tt-progress-text')).toHaveText('Step 2 of 3');
await settle(v);
await v.screenshot({ path: `${OUT}/exported-viewer-desktop.png` });
await v.context().close();
const vm = await openFile({ width: 390, height: 844 }, true);
await vm.locator('.tt-hotspot').tap();
await expect(vm.locator('.tt-progress-text')).toHaveText('Step 2 of 3');
await settle(vm);
await vm.screenshot({ path: `${OUT}/exported-viewer-mobile.png` });
await vm.context().close();

// 5. Phone: landing, then import the project file and open it in the editor.
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const m = await mctx.newPage();
await m.goto(BASE);
await settle(m, 1800);
await m.screenshot({ path: `${OUT}/landing-mobile.png` });
await m.goto(`${BASE}#/studio`);
await m.getByTestId('import-input').setInputFiles(json);
await expect(m.getByText('Imported "Turn on two-step verification"')).toBeVisible();
await m.getByRole('link', { name: 'Edit' }).first().click();
await expect(m.getByTestId('step-item')).toHaveCount(3);
await settle(m);
await m.evaluate(() => window.scrollTo(0, 0));
await m.screenshot({ path: `${OUT}/editor-mobile.png` });
await mctx.close();

// 6. Arabic (right-to-left) landing page.
const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const a = await actx.newPage();
await a.goto(BASE);
await a.evaluate(() => localStorage.setItem('taptrail.lang', 'ar'));
await a.reload();
await expect(a.locator('html')).toHaveAttribute('dir', 'rtl');
await settle(a, 1800);
await a.screenshot({ path: `${OUT}/landing-arabic.png` });

await browser.close();
console.log(`Screenshots written to ${OUT} from ${BASE}`);
