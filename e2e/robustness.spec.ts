import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import {
  addScreenshots, createGuide, drag, exportHtml, exportJson, openOffline, patternPng, readExportedData, shot, writeTmp,
} from './helpers';

test.describe('project JSON export and import', () => {
  test('round trip keeps title, steps, instructions and hotspots', async ({ page }) => {
    await createGuide(page, 'Round trip', 'Describes it');
    await addScreenshots(page, [writeTmp('rt1.png', patternPng(300, 500, 0)), writeTmp('rt2.png', patternPng(300, 500, 1))]);
    await page.getByTestId('step-item').nth(0).click();
    await drag(page, [0.2, 0.2], [0.6, 0.35]);
    await page.getByLabel('What should the reader do?').fill('First instruction');
    await page.getByTestId('step-item').nth(1).click();
    await page.getByLabel('What should the reader do?').fill('Second, no hotspot');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    const json = await exportJson(page, 'rt.taptrail.json');

    // Delete the guide (with confirmation), then import the file again.
    await page.goto('#/studio');
    await page.getByRole('button', { name: /Delete/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete guide' }).click();
    await expect(page.getByText('No guides yet')).toBeVisible();

    await page.getByTestId('import-input').setInputFiles(json);
    await expect(page.getByRole('status').filter({ hasText: 'Imported "Round trip"' })).toBeVisible();
    await page.getByRole('link', { name: 'Round trip', exact: true }).click();
    await expect(page.getByTestId('step-item')).toHaveCount(2);
    await expect(page.getByRole('textbox', { name: 'Guide name' })).toHaveValue('Round trip');
    await page.getByTestId('step-item').nth(0).click();
    await expect(page.getByLabel('What should the reader do?')).toHaveValue('First instruction');
    const stage = (await page.getByTestId('image-stage').boundingBox())!;
    const hb = (await page.getByTestId('hotspot-box').boundingBox())!;
    expect((hb.x - stage.x) / stage.width).toBeCloseTo(0.2, 1);
    expect(hb.width / stage.width).toBeCloseTo(0.4, 1);
    await page.getByTestId('step-item').nth(1).click();
    await expect(page.getByLabel('What should the reader do?')).toHaveValue('Second, no hotspot');
    await expect(page.getByTestId('hotspot-box')).toHaveCount(0);
  });

  test('rejects invalid and malicious project files without importing anything', async ({ page }) => {
    await page.goto('#/studio');
    const input = page.getByTestId('import-input');
    const alert = page.getByRole('alert').first();
    const cases: [string, string, string][] = [
      ['notjson.json', '<script>alert(1)</script>', 'does not look like a TapTrail project file'],
      ['wrong.json', '{"hello":"world"}', 'not a TapTrail project'],
      ['version.json', '{"format":"taptrail-project","version":42,"guide":{}}', 'newer version'],
      ['badguide.json', '{"format":"taptrail-project","version":1,"guide":{"title":"x","steps":[{"image":"https://evil.example/a.png","width":10,"height":10}]}}', 'not a valid PNG, JPEG or WebP'],
      ['svg.json', JSON.stringify({ format: 'taptrail-project', version: 1, guide: { title: 'x', steps: [{ instruction: '', image: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIG9ubG9hZD0iYWxlcnQoMSkiLz4=', width: 10, height: 10, hotspot: null }] } }), 'not a valid PNG, JPEG or WebP'],
    ];
    for (const [name, body, message] of cases) {
      await input.setInputFiles(writeTmp(name, body));
      await expect(alert).toContainText(message);
    }
    // A file that declares PNG but is not decodable is rejected by the real decoder.
    const fakeBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(80, 7)]);
    const sneaky = JSON.stringify({ format: 'taptrail-project', version: 1, guide: { title: 'sneaky', steps: [{ instruction: '', image: `data:image/png;base64,${fakeBytes.toString('base64')}`, width: 10, height: 10, hotspot: null }] } });
    await input.setInputFiles(writeTmp('sneaky.json', sneaky));
    await expect(alert).toContainText('could not be read');
    await expect(page.getByText('No guides yet')).toBeVisible();
  });
});

test.describe('untrusted text never becomes executable', () => {
  test('HTML/script-looking titles and instructions stay inert in the app and in the exported file', async ({ page, browser }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const evilTitle = '<img src=x onerror="alert(\'title\')">Guide';
    const evilStep = '</script><script>alert("step")</script><svg onload=alert(1)>';
    await createGuide(page, evilTitle, evilStep);
    await addScreenshots(page, [writeTmp('evil.png', patternPng(200, 300))]);
    await page.getByLabel('What should the reader do?').fill(evilStep);
    await drag(page, [0.2, 0.2], [0.6, 0.4]);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    const file = await exportHtml(page, 'evil.html');
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('</script><script>alert');
    expect(raw).not.toContain('<img src=x');
    expect(raw.match(/<script/g)).toHaveLength(2);
    expect(readExportedData(file).steps[0]!.instruction).toBe(evilStep);

    const v = await openOffline(browser, file);
    await expect(v.page.getByRole('heading', { level: 1 })).toHaveText(evilTitle);
    await expect(v.page.locator('.tt-instruction')).toHaveText(evilStep);
    await expect(v.page.locator('img[src="x"], svg[onload]')).toHaveCount(0);
    await v.page.locator('.tt-hotspot').click();
    expect(v.problems).toEqual([]);
    await v.context.close();

    await page.goto('#/studio');
    await expect(page.locator('h2 a').first()).toHaveText(evilTitle);
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('bad files and storage limits', () => {
  test('rejects non-images, SVG and oversized files with clear messages, accepts the good file', async ({ page }) => {
    await createGuide(page, 'Uploads');
    const big = Buffer.concat([patternPng(100, 100), Buffer.alloc(16 * 1024 * 1024)]);
    await page.getByTestId('file-input').setInputFiles([
      writeTmp('fake.png', 'this is just text'),
      writeTmp('vector.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      writeTmp('huge.png', big),
      writeTmp('broken.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)])),
      writeTmp('good.png', patternPng(120, 200)),
    ]);
    const notices = page.getByTestId('notices');
    await expect(notices).toContainText('fake.png: This is not a PNG, JPEG or WebP image.');
    await expect(notices).toContainText('vector.svg: This is not a PNG, JPEG or WebP image.');
    await expect(notices).toContainText('huge.png: This file is larger than 15 MB.');
    await expect(notices).toContainText('broken.png: This image could not be read');
    await expect(page.getByTestId('step-item')).toHaveCount(1);
  });

  test('downscales very large screenshots and keeps the guide usable', async ({ page }) => {
    await createGuide(page, 'Large');
    await addScreenshots(page, [writeTmp('wide.png', patternPng(3000, 1200))]);
    const dims = await page.getByTestId('image-stage').locator('img').evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight]);
    expect(Math.max(...dims)).toBeLessThanOrEqual(2000);
    expect(dims[0]! / dims[1]!).toBeCloseTo(2.5, 1);
  });

  test('a full browser storage never silently loses work: clear message, retry and backup', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __failPuts: boolean };
      w.__failPuts = false;
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (w.__failPuts) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return original.apply(this, args);
      };
    });
    await createGuide(page, 'Quota test');
    await addScreenshots(page, [writeTmp('q.png', patternPng(200, 300))]);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');

    await page.evaluate(() => ((window as unknown as { __failPuts: boolean }).__failPuts = true));
    await page.getByLabel('What should the reader do?').fill('Work that must not be lost');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'error');
    const alert = page.getByRole('alert').filter({ hasText: 'could not be saved' });
    await expect(alert).toContainText('storage is full');
    await shot(page, 'storage-full');

    // The text is still in the editor, and a backup can still be downloaded.
    await expect(page.getByLabel('What should the reader do?')).toHaveValue('Work that must not be lost');
    const [dl] = await Promise.all([page.waitForEvent('download'), alert.getByRole('button', { name: 'Download a backup file' }).click()]);
    const backup = JSON.parse(readFileSync(await dl.path(), 'utf8')) as { guide: { steps: { instruction: string }[] } };
    expect(backup.guide.steps[0]!.instruction).toBe('Work that must not be lost');

    // Adding another screenshot while full reports a message instead of failing silently.
    await page.getByTestId('file-input').setInputFiles(writeTmp('q2.png', patternPng(200, 300)));
    await expect(page.getByTestId('notices')).toContainText('storage is full');

    // Space frees up: retry saves everything.
    await page.evaluate(() => ((window as unknown as { __failPuts: boolean }).__failPuts = false));
    await alert.getByRole('button', { name: 'Try saving again' }).click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page.getByLabel('What should the reader do?')).toHaveValue('Work that must not be lost');
  });
});

test.describe('keyboard operation of the creator', () => {
  test('a hotspot can be created, moved and resized without a mouse', async ({ page }) => {
    await createGuide(page, 'Keyboard');
    await addScreenshots(page, [writeTmp('kb.png', patternPng(200, 300))]);
    await page.getByRole('button', { name: 'Add a tap area' }).focus();
    await page.keyboard.press('Enter');
    const box = page.getByTestId('hotspot-box');
    await expect(box).toBeVisible();
    await box.focus();
    const x0 = (await box.boundingBox())!.x;
    const w0 = (await box.boundingBox())!.width;
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await box.boundingBox())!.x).toBeGreaterThan(x0 + 5);
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await box.boundingBox())!.width).toBeGreaterThan(w0 + 5);
    await page.keyboard.press('Delete');
    await expect(box).toHaveCount(0);
  });
});

test.describe('Arabic interface and RTL', () => {
  test('switches to Arabic with right-to-left layout and no horizontal overflow', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Switch language to Arabic' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('حوّل لقطات الشاشة');
    await expect(page.getByTestId('viewer-host').locator('.tt-viewer')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('viewer-host').locator('.tt-progress-text')).toContainText('الخطوة 1 من 5');
    await shot(page, 'landing-arabic');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // RTL: the logo is on the right, the Create button precedes the secondary button from the right
    const logo = (await page.getByRole('link', { name: 'الصفحة الرئيسية لـ TapTrail' }).boundingBox())!;
    expect(logo.x).toBeGreaterThan(600);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    // Preference persists across reloads
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('an Arabic guide exports as an RTL viewer with Arabic controls', async ({ page, browser }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Switch language to Arabic' }).click();
    await page.goto('#/studio/new');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('اسم الدليل').fill('كيف تفعّل الأمان');
    await dialog.getByRole('button', { name: 'إنشاء الدليل' }).click();
    await expect(page).toHaveURL(/#\/edit\//);
    await page.getByTestId('file-input').setInputFiles([writeTmp('ar1.png', patternPng(200, 300)), writeTmp('ar2.png', patternPng(200, 300, 1))]);
    await expect(page.getByTestId('step-item')).toHaveCount(2);
    await page.getByTestId('step-item').nth(0).click();
    await page.getByLabel('ماذا يجب على القارئ أن يفعل؟').fill('اضغط على الإعدادات');
    await drag(page, [0.2, 0.2], [0.6, 0.4]);
    await shot(page, 'editor-arabic');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await page.getByRole('button', { name: 'تصدير' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-html').click()]);
    const file = writeTmp('arabic.html', '');
    await dl.saveAs(file);
    const v = await openOffline(browser, file);
    await expect(v.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(v.page.locator('.tt-progress-text')).toHaveText('الخطوة 1 من 2');
    await expect(v.page.locator('.tt-instruction')).toHaveText('اضغط على الإعدادات');
    await v.page.keyboard.press('ArrowLeft'); // RTL: left = forward
    await expect(v.page.locator('.tt-progress-text')).toHaveText('الخطوة 2 من 2');
    await shot(v.page, 'exported-viewer-arabic');
    await v.context.close();
  });
});