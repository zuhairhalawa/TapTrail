import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TMP = resolve(import.meta.dirname, '.tmp');
mkdirSync(TMP, { recursive: true });

export type RGB = [number, number, number];

/** Write a PNG (RGBA) where `paint(x, y)` decides every pixel. No dependencies. */
export function makePng(width: number, height: number, paint: (x: number, y: number) => RGB): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      raw.set([r, g, b, 255], row + 1 + x * 4);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Insert a tEXt metadata chunk after IHDR (this is how a PNG can carry hidden text). */
export function addPngText(png: Buffer, keyword: string, text: string): Buffer {
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from('tEXt'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  const chunk = Buffer.concat([len, body, crc]);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

/** Insert an EXIF-style APP1 segment right after the JPEG start marker. */
export function addJpegExif(jpeg: Buffer, text: string): Buffer {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from(text, 'latin1')]);
  const seg = Buffer.alloc(4);
  seg.set([0xff, 0xe1]);
  seg.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), seg, payload, jpeg.subarray(2)]);
}

/** Have the browser encode a real JPEG (so we do not need a JPEG encoder here). */
export async function makeJpeg(page: Page, width = 300, height = 500): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement('canvas');
      c.width = w!;
      c.height = h!;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, w!, h!);
      g.addColorStop(0, '#d33');
      g.addColorStop(1, '#36c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w!, h!);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1]!;
    },
    [width, height],
  );
  return Buffer.from(b64!, 'base64');
}

export const SECRET_REGION = { x: 0.2, y: 0.4, w: 0.5, h: 0.12 }; // normalized

/** A screen with a recognizable pattern: dark blue background, green "secret" block, red tap target. */
export function patternPng(width = 360, height = 640, tint = 0): Buffer {
  return makePng(width, height, (x, y) => {
    const nx = x / width;
    const ny = y / height;
    const s = SECRET_REGION;
    if (nx >= s.x && nx <= s.x + s.w && ny >= s.y && ny <= s.y + s.h) return [0, 255, 0];
    if (nx >= 0.1 && nx <= 0.4 && ny >= 0.75 && ny <= 0.85) return [255, 0, 0];
    return [20 + tint * 40, 30, 120];
  });
}

export function writeTmp(name: string, data: Buffer | string): string {
  const p = join(TMP, name);
  writeFileSync(p, data);
  return p;
}

export async function createGuide(page: Page, title: string, description = ''): Promise<void> {
  await page.goto('#/studio/new');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Guide name').fill(title);
  if (description) await dialog.getByLabel('Short description (optional)').fill(description);
  await dialog.getByRole('button', { name: 'Create guide' }).click();
  await expect(page).toHaveURL(/#\/edit\//);
  await expect(page.getByTestId('dropzone')).toBeVisible();
}

export async function addScreenshots(page: Page, files: string[]): Promise<void> {
  const before = await page.getByTestId('step-item').count();
  await page.getByTestId('file-input').setInputFiles(files);
  await expect(page.getByTestId('step-item')).toHaveCount(before + files.length);
  await expect(page.getByTestId('image-stage').locator('img')).toBeVisible();
}

/** Drag on the stage using fractions of its size. */
export async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.getByTestId('image-stage').evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const box = (await page.getByTestId('image-stage').boundingBox())!;
  const pt = ([fx, fy]: [number, number]) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  const a = pt(from);
  const b = pt(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

export async function exportHtml(page: Page, name = 'guide.html'): Promise<string> {
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-html').click()]);
  const path = join(TMP, name);
  await download.saveAs(path);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  return path;
}

export async function exportJson(page: Page, name = 'guide.taptrail.json'): Promise<string> {
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  const path = join(TMP, name);
  await download.saveAs(path);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  return path;
}

export interface ExportedGuide {
  title: string;
  description: string;
  lang: string;
  steps: { instruction: string; image: string; width: number; height: number; hotspot: { x: number; y: number; w: number; h: number } | null }[];
}

export function readExportedData(htmlPath: string): ExportedGuide {
  const html = readFileSync(htmlPath, 'utf8');
  const m = /<script type="application\/json" id="taptrail-data">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('no data block');
  return JSON.parse(m[1]!) as ExportedGuide;
}

export function imageBytes(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

export interface OfflineViewer {
  page: Page;
  context: BrowserContext;
  requests: string[];
  problems: string[];
}

/** Open an exported file from disk in a fresh browser context that has NO network access. */
export async function openOffline(browser: Browser, file: string, viewport = { width: 1280, height: 900 }, extra: { isMobile?: boolean; hasTouch?: boolean } = {}): Promise<OfflineViewer> {
  const context = await browser.newContext({ offline: true, viewport, serviceWorkers: 'block', ...extra });
  const page = await context.newPage();
  const requests: string[] = [];
  const problems: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => {
    problems.push(`dialog: ${d.message()}`);
    void d.dismiss();
  });
  await page.goto(pathToFileURL(file).href);
  await expect(page.locator('.tt-viewer')).toBeVisible();
  return { page, context, requests, problems };
}

export async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  if (!process.env.SHOTS) return;
  await page.waitForTimeout(600); // let entrance animations settle
  mkdirSync(resolve(import.meta.dirname, '../docs/screenshots'), { recursive: true });
  await page.screenshot({ path: resolve(import.meta.dirname, `../docs/screenshots/${name}.png`), fullPage });
}

/** Sample the colour of the image displayed in the exported viewer at a normalized position. */
export async function pixelAt(page: Page, dataUrl: string, nx: number, ny: number): Promise<[number, number, number]> {
  return page.evaluate(
    async ([url, fx, fy]) => {
      const img = new Image();
      img.src = url as string;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(Math.min(c.width - 1, Math.floor((fx as number) * c.width)), Math.min(c.height - 1, Math.floor((fy as number) * c.height)), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    },
    [dataUrl, nx, ny] as const,
  );
}

// ---------------------------------------------------------------------------------------------
// Studio thumbnail (redaction) scenario, shared by the desktop/firefox/webkit and mobile specs.
// ---------------------------------------------------------------------------------------------

/** Secret block placed in the TOP of a portrait screenshot so that the cropped (object-cover/top) card thumbnail still shows it. */
export const THUMB_SECRET = { x: 0.2, y: 0.03, w: 0.6, h: 0.1 };
const THUMB_MARKER = { x: 0.1, y: 0.17, w: 0.3, h: 0.04 };

export function thumbPng(width = 360, height = 640): Buffer {
  return makePng(width, height, (x, y) => {
    const nx = x / width;
    const ny = y / height;
    const s = THUMB_SECRET;
    const m = THUMB_MARKER;
    if (nx >= s.x && nx <= s.x + s.w && ny >= s.y && ny <= s.y + s.h) return [0, 255, 0];
    if (nx >= m.x && nx <= m.x + m.w && ny >= m.y && ny <= m.y + m.h) return [255, 0, 0];
    return [20, 30, 120];
  });
}

/** Record every object URL the app creates/revokes so cleanup can be asserted. Call before the first goto. */
export async function trackObjectUrls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __created: string[]; __revoked: string[] };
    w.__created = [];
    w.__revoked = [];
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource) => {
      const u = create(o);
      w.__created.push(u);
      return u;
    };
    URL.revokeObjectURL = (u: string) => {
      w.__revoked.push(u);
      revoke(u);
    };
  });
}

export interface ThumbReport {
  src: string;
  natural: [number, number];
  shown: [number, number];
  /** Fraction of displayed (on-screen) pixels inside the cover rect that are still green. */
  greenInCover: number;
  /** Fraction of displayed pixels in the inner 80% of the cover rect that are (near) black. */
  blackInCover: number;
  outside: [number, number, number];
  marker: [number, number, number];
  coverVisible: boolean;
}

/**
 * Screenshot the Studio thumbnail as the user sees it and measure the covered region in those
 * on-screen pixels (so CSS cropping/scaling is included), not just the image bytes.
 */
export async function measureStudioThumbnail(page: Page, cover: { x: number; y: number; w: number; h: number }): Promise<ThumbReport> {
  const img = page.locator('ul[aria-label] li img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await img.scrollIntoViewIfNeeded();
  const png = await img.screenshot({ scale: 'css', animations: 'disabled' });
  const info = await img.evaluate((i: HTMLImageElement) => ({ src: i.currentSrc, nw: i.naturalWidth, nh: i.naturalHeight, w: i.clientWidth, h: i.clientHeight }));
  const m = await page.evaluate(
    async ([b64, nw, nh, w, h, c, mk]) => {
      const bmp = new Image(); // (fetch of data: URLs is blocked by the app CSP; an img element is allowed)
      bmp.src = `data:image/png;base64,${b64}`;
      await bmp.decode();
      const cv = document.createElement('canvas');
      cv.width = bmp.naturalWidth;
      cv.height = bmp.naturalHeight;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const k = bmp.naturalWidth / (w as number); // screenshot px per CSS px (1 with scale:'css')
      const scale = Math.max((w as number) / (nw as number), (h as number) / (nh as number)); // object-cover
      const offX = ((w as number) - (nw as number) * scale) / 2;
      const toX = (fx: number) => (offX + fx * (nw as number) * scale) * k;
      const toY = (fy: number) => fy * (nh as number) * scale * k; // object-top
      const px = (fx: number, fy: number) => {
        const sx = Math.floor(toX(fx));
        const sy = Math.floor(toY(fy));
        if (sx < 0 || sy < 0 || sx >= bmp.naturalWidth || sy >= bmp.naturalHeight) return [-1, -1, -1] as [number, number, number]; // cropped out of view
        const d = ctx.getImageData(sx, sy, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!] as [number, number, number];
      };
      const cc = c as { x: number; y: number; w: number; h: number };
      const x0 = Math.floor(toX(cc.x));
      const x1 = Math.ceil(toX(cc.x + cc.w));
      const y0 = Math.floor(toY(cc.y));
      const y1 = Math.ceil(toY(cc.y + cc.h));
      const visible = x0 >= 0 && y0 >= 0 && x1 <= bmp.naturalWidth && y1 <= bmp.naturalHeight && x1 > x0 && y1 > y0;
      let green = 0;
      let total = 0;
      let black = 0;
      let innerTotal = 0;
      if (visible) {
        const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        for (let i = 0; i < d.length; i += 4) {
          total++;
          if (d[i + 1]! > 150 && d[i]! < 100 && d[i + 2]! < 100) green++;
        }
        const ix0 = x0 + Math.floor((x1 - x0) * 0.1);
        const ix1 = x1 - Math.floor((x1 - x0) * 0.1);
        const iy0 = y0 + Math.floor((y1 - y0) * 0.1);
        const iy1 = y1 - Math.floor((y1 - y0) * 0.1);
        const inner = ctx.getImageData(ix0, iy0, ix1 - ix0, iy1 - iy0).data;
        for (let i = 0; i < inner.length; i += 4) {
          innerTotal++;
          if (Math.max(inner[i]!, inner[i + 1]!, inner[i + 2]!) < 20) black++;
        }
      }
      const mm = mk as { x: number; y: number; w: number; h: number };
      return {
        coverVisible: visible,
        greenInCover: total ? green / total : 1,
        blackInCover: innerTotal ? black / innerTotal : 0,
        outside: px(0.9, 0.1),
        marker: px(mm.x + mm.w / 2, mm.y + mm.h / 2),
      };
    },
    [png.toString('base64'), info.nw, info.nh, info.w, info.h, cover, THUMB_MARKER] as const,
  );
  return { src: info.src, natural: [info.nw, info.nh], shown: [info.w, info.h], ...m };
}

/** Pixel of the editor working image at a normalized point (tests that the draft still holds original bytes). */
export function editorStagePixel(page: Page, nx: number, ny: number): Promise<[number, number, number]> {
  return page.locator('[data-testid=image-stage] img').evaluate(
    async (el, [fx, fy]) => {
      const img = el as HTMLImageElement;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(Math.floor(fx! * c.width), Math.floor(fy! * c.height), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    },
    [nx, ny] as const,
  );
}

/** The full scenario: pending redaction on step 1 -> Studio card must show covered pixels, draft must stay editable/unredacted. */
export async function studioThumbnailScenario(page: Page): Promise<void> {
  await trackObjectUrls(page);
  await createGuide(page, 'Thumbnail privacy');
  await addScreenshots(page, [writeTmp('thumb.png', thumbPng())]);
  await page.getByRole('button', { name: 'Cover private info' }).click();
  const s = THUMB_SECRET;
  await drag(page, [s.x - 0.04, s.y - 0.02], [s.x + s.w + 0.04, s.y + s.h + 0.02]);
  await expect(page.getByTestId('redaction-box')).toHaveCount(1);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const editUrl = page.url();

  await page.goto('#/studio');
  const report = await measureStudioThumbnail(page, s);
  expect(report.src, 'thumbnail is an object URL').toMatch(/^blob:/);
  expect(report.natural, 'thumbnail keeps the image dimensions').toEqual([360, 640]);
  expect(report.coverVisible, 'covered region must be inside the visible thumbnail crop').toBe(true);
  expect(report.greenInCover, 'no original (green) pixels may be visible inside the covered region of the thumbnail').toBe(0);
  expect(report.blackInCover, 'covered region of the thumbnail is solid black').toBeGreaterThan(0.98);
  expect(report.outside[2], 'uncovered background untouched').toBeGreaterThan(90);
  expect(report.marker[0], 'other content untouched').toBeGreaterThan(200);

  // Leaving the Studio must release the thumbnail object URL.
  await page.goto(editUrl.slice(editUrl.indexOf('#')));
  await expect(page.getByTestId('image-stage').locator('img')).toBeVisible();
  const revoked = await page.evaluate((u) => (window as unknown as { __revoked: string[] }).__revoked.includes(u), report.src);
  expect(revoked, 'thumbnail object URL revoked after leaving the Studio').toBe(true);

  // The editable draft is NOT redacted: original green is still underneath, and the box is still editable.
  await expect(page.getByTestId('redaction-box')).toHaveCount(1);
  const centre = await editorStagePixel(page, s.x + s.w / 2, s.y + s.h / 2);
  expect(centre[1], 'draft bytes still hold the unredacted original').toBeGreaterThan(200);
  expect(centre[0]).toBeLessThan(40);
}

// ---------------------------------------------------------------------------------------------
// IndexedDB inspection / fault injection for import + autosave tests.
// ---------------------------------------------------------------------------------------------

export interface DbCounts {
  guides: number;
  images: number;
  imageIds: string[];
  referencedImageIds: string[];
  guideTitles: string[];
}

/** Read the app database directly (read-only). */
export function dbCounts(page: Page): Promise<DbCounts> {
  return page.evaluate(
    () =>
      new Promise<DbCounts>((resolve, reject) => {
        const open = indexedDB.open('taptrail');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const d = open.result;
          const tx = d.transaction(['guides', 'images'], 'readonly');
          const g = tx.objectStore('guides').getAll();
          const i = tx.objectStore('images').getAll();
          tx.oncomplete = () => {
            d.close();
            const guides = g.result as { title: string; steps: { imageId: string }[] }[];
            const images = i.result as { id: string }[];
            resolve({
              guides: guides.length,
              images: images.length,
              imageIds: images.map((x) => x.id).sort(),
              referencedImageIds: guides.flatMap((x) => x.steps.map((s) => s.imageId)).sort(),
              guideTitles: guides.map((x) => x.title).sort(),
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

/**
 * Install quota-failure injection: while window.__failWrites is a number n, the (n+1)-th and every
 * later write (put/add) on the guides/images stores throws QuotaExceededError (counted from
 * window.__writes, which tests reset). true fails every write; null/undefined fails none.
 * Must be called before the first goto.
 */
export async function installWriteFaults(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __failWrites: boolean | number | null; __writes: number };
    w.__failWrites = null;
    w.__writes = 0;
    for (const method of ['put', 'add'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: [unknown, IDBValidKey?]) {
        if (this.name === 'guides' || this.name === 'images') {
          const f = w.__failWrites;
          if (f === true || (typeof f === 'number' && w.__writes >= f)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          w.__writes++;
        }
        return (original as (...a: unknown[]) => IDBRequest).apply(this, args);
      } as typeof original;
    }
  });
}

/** Make saves slow: window.__holdDb(ms) keeps a read-write transaction on the stores busy from a second connection. */
export async function installDbHold(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __holdDb: (ms: number) => Promise<void> }).__holdDb = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('taptrail');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const d = open.result;
          const tx = d.transaction(['guides', 'images'], 'readwrite');
          const store = tx.objectStore('guides');
          const end = performance.now() + ms;
          const spin = () => {
            if (performance.now() < end) store.get('__hold__').onsuccess = spin;
          };
          spin();
          tx.oncomplete = () => d.close();
          resolve();
        };
      });
  });
}