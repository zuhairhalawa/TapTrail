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