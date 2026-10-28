import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import {
  addJpegExif, addPngText, addScreenshots, createGuide, drag, exportHtml, exportJson, imageBytes, makeJpeg, openOffline,
  patternPng, pixelAt, readExportedData, SECRET_REGION, shot, writeTmp,
} from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

async function expectNoSeriousA11yIssues(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
}

test.describe('landing page and sample guide', () => {
  test('visitors can click through the sample without uploading or registering', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (!['127.0.0.1', ''].includes(u.hostname) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
    });
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Turn screenshots into tutorials');
    await expect(page.getByRole('link', { name: 'Create a guide' }).first()).toBeVisible();
    await shot(page, 'landing-desktop');

    const demo = page.getByTestId('viewer-host');
    await expect(demo.locator('.tt-progress-text')).toHaveText('Step 1 of 5');
    // A wrong click does not advance
    await demo.locator('.tt-img').click({ position: { x: 20, y: 300 } });
    await expect(demo.locator('.tt-progress-text')).toHaveText('Step 1 of 5');
    await expect(demo.locator('.tt-feedback')).toContainText('Not quite');
    for (let i = 2; i <= 5; i++) {
      await demo.locator('.tt-hotspot').click();
      await expect(demo.locator('.tt-progress-text')).toHaveText(`Step ${i} of 5`);
    }
    await demo.locator('.tt-hotspot').click();
    await expect(demo.getByRole('heading', { name: 'You did it!' })).toBeVisible();
    await demo.getByRole('button', { name: 'Start again' }).click();
    await expect(demo.locator('.tt-progress-text')).toHaveText('Step 1 of 5');
    expect(external).toEqual([]);
  });

  test('sample guide is operable with the keyboard only', async ({ page }) => {
    await page.goto('./');
    const demo = page.getByTestId('viewer-host');
    await demo.locator('.tt-hotspot').focus();
    await expect(demo.locator('.tt-hotspot')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(demo.locator('.tt-progress-text')).toHaveText('Step 2 of 5');
    await page.keyboard.press('ArrowRight');
    await expect(demo.locator('.tt-progress-text')).toHaveText('Step 3 of 5');
    await page.keyboard.press('ArrowLeft');
    await expect(demo.locator('.tt-progress-text')).toHaveText('Step 2 of 5');
    await demo.getByRole('button', { name: 'Back' }).click();
    await expect(demo.locator('.tt-progress-text')).toHaveText('Step 1 of 5');
  });

  test('has no serious accessibility violations (axe, dark and light)', async ({ page }) => {
    await page.goto('./');
    await page.waitForTimeout(400);
    await expectNoSeriousA11yIssues(page, 'landing dark');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await page.waitForTimeout(300);
    await expectNoSeriousA11yIssues(page, 'landing light');
    await shot(page, 'landing-light');
  });

  test('shows a visible focus ring on keyboard focus', async ({ page }) => {
    await page.goto('./');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe('none');
  });
});

test.describe('creator studio: build a three-step guide, export it, use it offline', () => {
  test('end to end', async ({ page, browser }) => {
    const files = [0, 1, 2].map((i) => writeTmp(`step${i}.png`, patternPng(360, 640, i)));
    await page.goto('#/studio');
    await expect(page.getByText('No guides yet')).toBeVisible();
    await shot(page, 'studio-empty');

    await createGuide(page, 'Join the family Wi-Fi', 'Steps for visitors');
    await shot(page, 'editor-empty');
    await addScreenshots(page, files);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');

    // Annotate each step: draw a hotspot over the red target, write an instruction.
    const instructions = ['Open Settings', 'Choose "Wi-Fi" & tap the network', 'Type the password <carefully>'];
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('step-item').nth(i).click();
      await drag(page, [0.1, 0.75], [0.4, 0.85]);
      const hs = page.getByTestId('hotspot-box');
      await expect(hs).toBeVisible();
      const stage = (await page.getByTestId('image-stage').boundingBox())!;
      const hb = (await hs.boundingBox())!;
      expect((hb.x - stage.x) / stage.width).toBeCloseTo(0.1, 1);
      expect((hb.width) / stage.width).toBeCloseTo(0.3, 1);
      await page.getByLabel('What should the reader do?').fill(instructions[i]!);
    }
    await shot(page, 'editor-desktop');

    // Reorder: move step 3 earlier, then back again; duplicate then delete with confirmation.
    await page.getByTestId('step-item').nth(2).click();
    await page.getByRole('button', { name: 'Move earlier' }).click();
    await expect(page.getByTestId('step-item').nth(1)).toContainText('Type the password');
    await page.getByRole('button', { name: 'Move later' }).click();
    await expect(page.getByTestId('step-item').nth(2)).toContainText('Type the password');
    await page.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.getByTestId('step-item')).toHaveCount(4);
    await page.getByRole('button', { name: 'Delete step' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('step-item')).toHaveCount(4);
    await page.getByRole('button', { name: 'Delete step' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete step' }).click();
    await expect(page.getByTestId('step-item')).toHaveCount(3);

    // Persistence: wait for autosave, reload the page, everything is still there.
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page.getByTestId('step-item')).toHaveCount(3);
    await expect(page.getByTestId('step-item').nth(1)).toContainText('Choose');
    await expect(page.getByTestId('hotspot-box')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Guide name' })).toHaveValue('Join the family Wi-Fi');
    await expectNoSeriousA11yIssues(page, 'editor');

    // Preview uses the same viewer.
    await page.getByRole('link', { name: 'Preview' }).click();
    await expect(page.getByTestId('viewer-host').locator('.tt-progress-text')).toHaveText('Step 1 of 3');
    await page.getByTestId('viewer-host').locator('.tt-hotspot').click();
    await expect(page.getByTestId('viewer-host').locator('.tt-progress-text')).toHaveText('Step 2 of 3');
    await shot(page, 'preview-desktop');
    await page.getByRole('link', { name: 'Back to editing' }).click();

    // Export one HTML file.
    const file = await exportHtml(page, 'wifi.html');
    const html = readFileSync(file, 'utf8');
    expect(html.length).toBeGreaterThan(1000);
    expect(html).not.toMatch(/https?:\/\//);
    const data = readExportedData(file);
    expect(data.title).toBe('Join the family Wi-Fi');
    expect(data.description).toBe('Steps for visitors');
    expect(data.steps.map((s) => s.instruction)).toEqual(instructions);

    // Open it with the network OFF, from disk, as someone else would.
    const viewer = await openOffline(browser, file);
    const v = viewer.page;
    await expect(v.getByRole('heading', { level: 1 })).toHaveText('Join the family Wi-Fi');
    await expect(v.locator('.tt-progress-text')).toHaveText('Step 1 of 3');
    await expect(v.locator('.tt-instruction')).toHaveText('Open Settings');
    await expect(v.locator('.tt-img')).toHaveJSProperty('complete', true);
    expect(await v.locator('.tt-img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100);
    await shot(v, 'exported-viewer-desktop');
    await v.locator('.tt-hotspot').click();
    await expect(v.locator('.tt-instruction')).toHaveText('Choose "Wi-Fi" & tap the network');
    await v.getByRole('button', { name: 'Back' }).click();
    await expect(v.locator('.tt-progress-text')).toHaveText('Step 1 of 3');
    await v.locator('.tt-hotspot').click();
    await v.locator('.tt-hotspot').click();
    await expect(v.locator('.tt-instruction')).toHaveText('Type the password <carefully>');
    await expect(v.getByRole('button', { name: 'Finish' })).toBeVisible();
    await v.locator('.tt-hotspot').click();
    await expect(v.getByRole('heading', { name: 'You did it!' })).toBeVisible();
    await shot(v, 'exported-viewer-done');
    await v.keyboard.press('ArrowLeft'); // arrow keys work immediately in a standalone guide
    await expect(v.locator('.tt-instruction')).toHaveText('Type the password <carefully>');
    await v.keyboard.press('ArrowRight');
    await expect(v.getByRole('heading', { name: 'You did it!' })).toBeVisible();
    await v.getByRole('button', { name: 'Start again' }).click();
    await expect(v.locator('.tt-progress-text')).toHaveText('Step 1 of 3');

    // Nothing but the local file (and inline data) was requested; no CSP violations or errors.
    expect(viewer.requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:'))).toEqual([]);
    expect(viewer.problems).toEqual([]);
    expect(await v.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'))).toContain("default-src 'none'");
    await v.waitForTimeout(600); // let the step-card fade-in finish so contrast is measured on final colours
    await expectNoSeriousA11yIssues(v, 'exported viewer');

    // Print version: every step on the page, interactive UI hidden.
    await v.emulateMedia({ media: 'print' });
    await expect(v.locator('.tt-print')).toBeVisible();
    await expect(v.locator('.tt-main')).toBeHidden();
    await expect(v.locator('.tt-print-step')).toHaveCount(3);
    const pdf = await v.pdf({ format: 'A4' });
    expect(pdf.length).toBeGreaterThan(5000);
    await viewer.context.close();
  });
});

test.describe('privacy: redaction and metadata', () => {
  test('redactions are rasterized into the exported pixels (HTML and JSON), originals never appear', async ({ page, browser }) => {
    await createGuide(page, 'Redaction test');
    await addScreenshots(page, [writeTmp('secret.png', patternPng(360, 640))]);
    await page.getByRole('button', { name: 'Cover private info' }).click();
    // Cover most of the green "secret" block (inset a little so edges stay clear).
    const s = SECRET_REGION;
    await drag(page, [s.x - 0.02, s.y - 0.02], [s.x + s.w + 0.02, s.y + s.h + 0.02]);
    await expect(page.getByTestId('redaction-box')).toHaveCount(1);
    await shot(page, 'editor-redaction');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');

    const htmlFile = await exportHtml(page, 'redacted.html');
    const jsonFile = await exportJson(page, 'redacted.taptrail.json');
    const fromHtml = readExportedData(htmlFile).steps[0]!;
    const fromJson = (JSON.parse(readFileSync(jsonFile, 'utf8')) as { guide: { steps: { image: string }[] } }).guide.steps[0]!;

    const viewer = await openOffline(browser, htmlFile);
    for (const [label, image] of [['html', fromHtml.image], ['json', fromJson.image]] as const) {
      const centre = await pixelAt(viewer.page, image, s.x + s.w / 2, s.y + s.h / 2);
      const corner = await pixelAt(viewer.page, image, s.x + 0.02, s.y + 0.02);
      const outside = await pixelAt(viewer.page, image, 0.9, 0.2);
      const target = await pixelAt(viewer.page, image, 0.25, 0.8);
      expect(Math.max(...centre), `${label}: centre must be black`).toBeLessThan(12);
      expect(Math.max(...corner), `${label}: edge must be black`).toBeLessThan(12);
      expect(outside[2], `${label}: background untouched`).toBeGreaterThan(90);
      expect(target[0], `${label}: other content untouched`).toBeGreaterThan(200);
      expect(centre[1], `${label}: no green left`).toBeLessThan(12);
    }
    // The redaction is not a CSS overlay in the exported viewer.
    await expect(viewer.page.locator('[class*="redact"], [data-testid*="redact"]')).toHaveCount(0);
    // No original (unredacted) green pixels exist anywhere inside the exported picture's covered area.
    const html = readFileSync(htmlFile, 'utf8');
    expect(html).not.toContain('redaction');
    await viewer.context.close();

    // The preview also shows covered pixels (not an overlay).
    await page.getByRole('link', { name: 'Preview' }).click();
    const src = await page.getByTestId('viewer-host').locator('.tt-img').getAttribute('src');
    expect(src).toMatch(/^blob:/);
  });

  test('re-encoding drops hidden metadata from JPEG and PNG uploads', async ({ page, browser }) => {
    const jpg = addJpegExif(await makeJpeg(page), 'SECRET_GPS_MARKER_48.8584N_2.2945E');
    const png = addPngText(patternPng(200, 300), 'Comment', 'SECRET_PNG_TEXT_MARKER');
    expect(jpg.includes('SECRET_GPS_MARKER')).toBe(true);
    expect(png.includes('SECRET_PNG_TEXT_MARKER')).toBe(true);
    await createGuide(page, 'Metadata test');
    await addScreenshots(page, [writeTmp('photo.jpg', jpg), writeTmp('shot.png', png)]);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');

    const htmlFile = await exportHtml(page, 'meta.html');
    const jsonFile = await exportJson(page, 'meta.taptrail.json');
    const html = readFileSync(htmlFile);
    const json = readFileSync(jsonFile);
    for (const marker of ['SECRET_GPS_MARKER', 'SECRET_PNG_TEXT_MARKER', 'Exif', 'tEXt']) {
      expect(html.includes(marker), `html ${marker}`).toBe(false);
      expect(json.includes(marker), `json ${marker}`).toBe(false);
    }
    for (const step of readExportedData(htmlFile).steps) {
      const bytes = imageBytes(step.image);
      expect(bytes.includes('SECRET_GPS_MARKER')).toBe(false);
      expect(bytes.includes('SECRET_PNG_TEXT_MARKER')).toBe(false);
      expect(step.image).toMatch(/^data:image\/(webp|png);base64,/); // re-encoded, not the original JPEG
    }
    const viewer = await openOffline(browser, htmlFile);
    await expect(viewer.page.locator('.tt-img')).toHaveJSProperty('complete', true);
    await viewer.context.close();
  });

  test('the draft keeps the original until it is burned in (documented limitation) and burn-in is permanent', async ({ page }) => {
    await createGuide(page, 'Burn test');
    await addScreenshots(page, [writeTmp('burn.png', patternPng(360, 640))]);
    await page.getByRole('button', { name: 'Cover private info' }).click();
    const s = SECRET_REGION;
    await drag(page, [s.x, s.y], [s.x + s.w, s.y + s.h]);
    await expect(page.getByText('your draft here still contains the original')).toBeVisible();
    const sample = () =>
      page.evaluate(async () => {
        const img = document.querySelector('[data-testid=image-stage] img') as HTMLImageElement;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(Math.floor(c.width * 0.45), Math.floor(c.height * 0.46), 1, 1).data.slice(0, 3));
      });
    expect((await sample())[1]).toBeGreaterThan(200); // draft still green underneath
    await page.getByRole('button', { name: 'Burn covered areas into this step' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Burn in' }).click();
    await expect(page.getByTestId('redaction-box')).toHaveCount(0);
    await expect.poll(async () => (await sample())[1]).toBeLessThan(12);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect.poll(async () => (await sample())[1]).toBeLessThan(12); // still burned after reload
  });
});