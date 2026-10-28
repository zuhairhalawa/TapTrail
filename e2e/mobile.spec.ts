import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addScreenshots, createGuide, drag, exportHtml, openOffline, patternPng, shot, writeTmp } from './helpers';

const noOverflow = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('mobile layout', () => {
  test('landing page fits the screen and the sample works by tapping', async ({ page }) => {
    await page.goto('./');
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, 'landing-mobile');
    const demo = page.getByTestId('viewer-host');
    await demo.scrollIntoViewIfNeeded();
    await demo.locator('.tt-hotspot').tap();
    await expect(demo.locator('.tt-progress-text')).toHaveText('Step 2 of 5');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  test('hotspots scale with the screenshot on a phone', async ({ page }) => {
    await page.goto('./');
    const stage = page.getByTestId('viewer-host').locator('.tt-stage');
    await stage.scrollIntoViewIfNeeded();
    const s = (await stage.boundingBox())!;
    const h = (await page.getByTestId('viewer-host').locator('.tt-hotspot').boundingBox())!;
    // Home screen avatar hotspot is defined as x=290/360, y=44/640, w=52/360 of the image.
    expect((h.x - s.x) / s.width).toBeCloseTo(290 / 360, 1);
    expect((h.y - s.y) / s.height).toBeCloseTo(44 / 640, 1);
    expect(h.width / s.width).toBeCloseTo(52 / 360, 1);
    expect(s.width).toBeLessThanOrEqual(412);
  });

  test('studio and editor work on a phone, and the exported guide is usable by touch', async ({ page, browser }) => {
    await page.goto('#/studio');
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await createGuide(page, 'Phone guide');
    await addScreenshots(page, [writeTmp('m1.png', patternPng(360, 640, 0)), writeTmp('m2.png', patternPng(360, 640, 1))]);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await page.getByTestId('step-item').nth(0).click();
    await drag(page, [0.1, 0.75], [0.4, 0.85]);
    await expect(page.getByTestId('hotspot-box')).toBeVisible();
    await page.getByLabel('What should the reader do?').fill('Tap the red button');
    await shot(page, 'editor-mobile');
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');

    const file = await exportHtml(page, 'phone.html');
    const v = await openOffline(browser, file, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
    expect(await noOverflow(v.page)).toBeLessThanOrEqual(0);
    const stage = (await v.page.locator('.tt-stage').boundingBox())!;
    expect(stage.width).toBeLessThanOrEqual(390);
    const hs = (await v.page.locator('.tt-hotspot').boundingBox())!;
    expect((hs.x - stage.x) / stage.width).toBeCloseTo(0.1, 1);
    expect(hs.width / stage.width).toBeCloseTo(0.3, 1);
    await shot(v.page, 'exported-viewer-mobile');
    await v.page.locator('.tt-hotspot').tap();
    await expect(v.page.locator('.tt-progress-text')).toHaveText('Step 2 of 2');
    const navBox = (await v.page.getByRole('button', { name: 'Finish' }).boundingBox())!;
    expect(navBox.height).toBeGreaterThanOrEqual(40); // comfortable touch target
    expect(v.problems).toEqual([]);
    await v.context.close();
  });
});