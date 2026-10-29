import { expect, test, type Page } from '@playwright/test';

/**
 * Creating a guide: every field is typed exactly ONCE. There is no refill loop, no retyping and no
 * whole-test retry behind these assertions; readiness is an observed state of the dialog (open, name
 * field focused by the dialog's own initialization), not a delay.
 */
const NAME = 'Guide name';
const DESC = 'Short description (optional)';

const storedDescriptions = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ title: string; description: string }[]>((resolve, reject) => {
        const open = indexedDB.open('taptrail');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const d = open.result;
          const req = d.transaction('guides', 'readonly').objectStore('guides').getAll();
          req.onsuccess = () => {
            d.close();
            resolve((req.result as { title: string; description?: string }[]).map((g) => ({ title: g.title, description: g.description ?? '' })));
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );

/** The dialog is open and its own initialization (modal shown, name field focused) has finished. */
async function dialogReady(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(NAME)).toBeFocused();
  await expect(dialog.getByLabel(NAME)).toBeEditable();
  return dialog;
}

/** Records every value the two fields hold during a short window after they were typed. */
const observeFields = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const n = document.querySelector<HTMLInputElement>('dialog input')!;
        const d = document.querySelector<HTMLTextAreaElement>('dialog textarea')!;
        const seen: string[] = [];
        const sample = () => seen.push(`${n.value}|${d.value}`);
        sample();
        const timer = setInterval(sample, 25);
        setTimeout(() => {
          clearInterval(timer);
          sample();
          resolve(seen);
        }, 500);
      }),
  );

test.describe('guide creation without input retries', () => {
  test('cold start: each field is typed once and both survive to the stored guide', async ({ browser }, info) => {
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({ ...info.project.use, serviceWorkers: 'block' }); // a brand-new profile every time = cold start
      const page = await context.newPage();
      try {
        await page.goto('#/studio/new');
        const dialog = await dialogReady(page);
        const title = `Cold guide ${i}`;
        const description = `Typed once, run ${i}`;
        await dialog.getByLabel(NAME).fill(title);
        await dialog.getByLabel(DESC).fill(description);
        await expect(dialog.getByLabel(NAME)).toHaveValue(title);
        await expect(dialog.getByLabel(DESC)).toHaveValue(description);
        expect(new Set(await observeFields(page))).toEqual(new Set([`${title}|${description}`])); // never reset, never empty
        await dialog.getByRole('button', { name: 'Create guide' }).click();
        await expect(page).toHaveURL(/#\/edit\//);
        await expect(page.getByTestId('dropzone')).toBeVisible();
        await expect.poll(() => storedDescriptions(page)).toEqual([{ title, description }]);
      } finally {
        await context.close();
      }
    }
  });

  test('reopening: Cancel, open again, the fields start from their initial values and one entry is enough', async ({ page }) => {
    await page.goto('#/studio/new');
    let dialog = await dialogReady(page);
    await dialog.getByLabel(NAME).fill('Abandoned');
    await dialog.getByLabel(DESC).fill('Abandoned description');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', { name: 'New guide' }).first().click();
    dialog = await dialogReady(page);
    await expect(dialog.getByLabel(NAME)).toHaveValue(''); // reset on reopening
    await expect(dialog.getByLabel(DESC)).toHaveValue('');
    await dialog.getByLabel(NAME).fill('Second try');
    await dialog.getByLabel(DESC).fill('Second description');
    expect(new Set(await observeFields(page))).toEqual(new Set(['Second try|Second description']));
    await dialog.getByRole('button', { name: 'Create guide' }).click();
    await expect(page).toHaveURL(/#\/edit\//);
    await expect.poll(() => storedDescriptions(page)).toEqual([{ title: 'Second try', description: 'Second description' }]);
  });

  test('rename keeps its initial value, accepts one edit and keeps keyboard focus on the name field', async ({ page }) => {
    await page.goto('#/studio/new');
    const dialog = await dialogReady(page);
    await dialog.getByLabel(NAME).fill('Before rename');
    await expect(dialog.getByLabel(NAME)).toHaveValue('Before rename');
    await dialog.getByRole('button', { name: 'Create guide' }).click();
    await expect(page).toHaveURL(/#\/edit\//);
    await page.goto('#/studio');
    await page.getByRole('button', { name: /Rename/ }).first().click();
    const rename = await dialogReady(page);
    await expect(rename.getByLabel(NAME)).toHaveValue('Before rename');
    await rename.getByLabel(NAME).fill('After rename');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => storedDescriptions(page).then((g) => g.map((x) => x.title))).toEqual(['After rename']);
  });
});
