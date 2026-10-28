import { expect, test, type Page } from '@playwright/test';
import { addScreenshots, createGuide, dbCounts, installDbHold, installWriteFaults, patternPng, writeTmp } from './helpers';

const INSTRUCTION = 'What should the reader do?';
const savedState = (page: Page) => page.getByTestId('save-status');

async function openEditorWithStep(page: Page, title: string) {
  await installWriteFaults(page);
  await installDbHold(page);
  await createGuide(page, title);
  await addScreenshots(page, [writeTmp('as.png', patternPng(200, 300))]);
  await expect(savedState(page)).toHaveAttribute('data-state', 'saved');
}

const instructionInDb = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('taptrail');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const d = open.result;
          const req = d.transaction('guides', 'readonly').objectStore('guides').getAll();
          req.onsuccess = () => {
            d.close();
            resolve((req.result as { steps: { instruction: string }[] }[])[0]?.steps[0]?.instruction ?? '');
          };
        };
      }),
  );

const previewText = (page: Page) => page.getByTestId('viewer-host').locator('.tt-instruction');

test.describe('editing then opening Preview right away', () => {
  test('an instruction typed a moment before clicking Preview is what Preview shows (no waiting for autosave)', async ({ page }) => {
    await openEditorWithStep(page, 'Race: immediate');
    await page.getByLabel(INSTRUCTION).fill('Typed just before Preview');
    await page.getByRole('link', { name: 'Preview' }).click(); // no wait for the 500 ms autosave
    await expect(page).toHaveURL(/#\/preview\//);
    await expect(previewText(page)).toHaveText('Typed just before Preview');
    expect(await instructionInDb(page)).toBe('Typed just before Preview');
    // and after a reload the edit is still there
    await page.goto(page.url().replace('#/preview/', '#/edit/'));
    await page.reload();
    await expect(page.getByLabel(INSTRUCTION)).toHaveValue('Typed just before Preview');
  });

  test('slow save: an edit made while an earlier save is still in flight is not left behind', async ({ page }) => {
    await openEditorWithStep(page, 'Race: slow save');
    await page.evaluate(() => (window as unknown as { __holdDb: (ms: number) => Promise<void> }).__holdDb(2500));
    await page.getByLabel(INSTRUCTION).fill('first edit');
    await expect(savedState(page)).toHaveAttribute('data-state', 'saving'); // the autosave of "first edit" is now stuck behind the hold
    await page.getByLabel(INSTRUCTION).fill('second edit');
    await expect(savedState(page)).not.toHaveAttribute('data-state', 'saved'); // never labelled saved while newer text is unsaved
    await page.getByRole('link', { name: 'Preview' }).click();
    await expect(page).toHaveURL(/#\/preview\//, { timeout: 15_000 });
    await expect(previewText(page)).toHaveText('second edit');
    expect(await instructionInDb(page)).toBe('second edit');
  });

  test('failing save: Preview does not open over unsaved work; the edit stays in the editor and can be retried', async ({ page }) => {
    await openEditorWithStep(page, 'Race: failing save');
    await page.evaluate(() => {
      const w = window as unknown as { __failWrites: boolean };
      w.__failWrites = true;
    });
    await page.getByLabel(INSTRUCTION).fill('Work that must not vanish');
    await page.getByRole('link', { name: 'Preview' }).click(); // the click itself triggers the (failing) save
    await expect(savedState(page)).toHaveAttribute('data-state', 'error');
    await expect(page.getByRole('alert').filter({ hasText: 'could not be saved' })).toBeVisible();
    await expect(page).toHaveURL(/#\/edit\//); // did not navigate away from the unsaved edit
    await expect(page.getByLabel(INSTRUCTION)).toHaveValue('Work that must not vanish');
    expect(await instructionInDb(page)).toBe(''); // really not saved, and the UI says so

    // Storage recovers: retry saves it, and Preview then shows it.
    await page.evaluate(() => ((window as unknown as { __failWrites: boolean | null }).__failWrites = null));
    await page.getByRole('button', { name: 'Try saving again' }).click();
    await expect(savedState(page)).toHaveAttribute('data-state', 'saved');
    expect(await instructionInDb(page)).toBe('Work that must not vanish');
    await page.getByRole('link', { name: 'Preview' }).click();
    await expect(previewText(page)).toHaveText('Work that must not vanish');
  });

  test('failing save after an autosave already failed: still no navigation, and Preview works once saving succeeds', async ({ page }) => {
    await openEditorWithStep(page, 'Race: failed then preview');
    await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = true));
    await page.getByLabel(INSTRUCTION).fill('Draft text');
    await expect(savedState(page)).toHaveAttribute('data-state', 'error'); // autosave failed on its own first
    await page.getByRole('link', { name: 'Preview' }).click();
    await expect(page).toHaveURL(/#\/edit\//);
    await expect(savedState(page)).toHaveAttribute('data-state', 'error');
    await expect(page.getByLabel(INSTRUCTION)).toHaveValue('Draft text');
    await page.evaluate(() => ((window as unknown as { __failWrites: boolean | null }).__failWrites = null));
    await page.getByRole('link', { name: 'Preview' }).click(); // clicking Preview again retries the save, then navigates
    await expect(page).toHaveURL(/#\/preview\//);
    await expect(previewText(page)).toHaveText('Draft text');
    const c = await dbCounts(page);
    expect(c.guides).toBe(1);
  });

  test('the Export dialog "Open preview" link follows the same rule: a failed save keeps you in the editor with the error visible', async ({ page }) => {
    await openEditorWithStep(page, 'Race: export dialog');
    await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = true));
    await page.getByLabel(INSTRUCTION).fill('Edit typed before the dialog link');
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Open preview' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); // closed so the failure is not hidden behind it
    await expect(savedState(page)).toHaveAttribute('data-state', 'error');
    await expect(page.getByRole('alert').filter({ hasText: 'could not be saved' })).toBeVisible();
    await expect(page).toHaveURL(/#\/edit\//);
    await expect(page.getByLabel(INSTRUCTION)).toHaveValue('Edit typed before the dialog link');
  });
});