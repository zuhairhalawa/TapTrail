import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  HELD_TEXT, INSTRUCTION_LABEL, addScreenshots, createGuide, drag, expectHeldInEditor, expectStored, openEditorWithStep, patternPng, qaShot, readNavLog,
  setFailWrites, storedGuides, writeTmp,
} from './helpers';

const status = (page: Page) => page.getByTestId('save-status');
const instruction = (page: Page) => page.getByLabel(INSTRUCTION_LABEL);
const leaveButton = (page: Page) => page.getByRole('button', { name: 'Leave without saving' });
const retryButton = (page: Page) => page.getByRole('button', { name: 'Try saving again' });
const previewLink = (page: Page) => page.getByRole('link', { name: 'Preview' });
const previewText = (page: Page) => page.getByTestId('viewer-host').locator('.tt-instruction');
const hold = (page: Page) => page.evaluate(() => (window as unknown as { __holdDbUntilReleased: () => Promise<void> }).__holdDbUntilReleased());
const release = (page: Page) => page.evaluate(() => (window as unknown as { __releaseDb: () => void }).__releaseDb());
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: number }).__writes);
const historyLength = (page: Page) => page.evaluate(() => history.length);
const currentHash = (page: Page) => page.evaluate(() => location.hash);
const firstInstruction = async (page: Page) => (await storedGuides(page))[0]?.instructions[0];

/** Unsaved work whose autosave has already failed: the state every exit below starts from. */
async function failedUnsavedEdit(page: Page, title: string, text = 'Unsaved work') {
  await openEditorWithStep(page, title);
  await setFailWrites(page, true);
  await instruction(page).fill(text);
  await expect(status(page)).toHaveAttribute('data-state', 'error');
  return text;
}

test.describe('failed save, then leaving by any internal route', () => {
  test('"All guides": stays, keeps the edit, offers retry and backup, and does not claim it saved', async ({ page }) => {
    const text = await failedUnsavedEdit(page, 'Nav: all guides', 'Unsaved A');
    await page.getByRole('link', { name: 'All guides' }).click();
    await expectHeldInEditor(page, text);
    expect(await firstInstruction(page)).toBe(''); // really not stored
    await qaShot(page, `held-all-guides-${test.info().project.name}`);

    // The backup carries the unsaved text.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download a backup file' }).click()]);
    expect(readFileSync(await download.path(), 'utf8')).toContain('Unsaved A');

    // Storage recovers: Retry stores it, the banner and the offer to leave go away, and we are still here.
    await setFailWrites(page, false);
    await retryButton(page).click();
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    expect(await firstInstruction(page)).toBe('Unsaved A');
    await expect(page.getByText(HELD_TEXT)).toHaveCount(0);
    await expect(leaveButton(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#\/edit\//);

    // Now leaving works.
    await page.getByRole('link', { name: 'All guides' }).click();
    await expect(page).toHaveURL(/#\/studio$/);
  });

  for (const [label, linkName, url] of [
    ['Home (logo)', 'TapTrail home', /#\/$/],
    ['Studio (My guides)', 'My guides', /#\/studio$/],
    ['Privacy', 'Privacy', /#\/privacy$/],
  ] as const) {
    test(`header link ${label}: stays in the editor; the next click retries the save and then goes`, async ({ page }) => {
      const text = await failedUnsavedEdit(page, `Nav: header ${label}`);
      await page.getByRole('link', { name: linkName, exact: true }).click();
      await expectHeldInEditor(page, text);
      expect(await firstInstruction(page)).toBe('');
      await setFailWrites(page, false);
      await page.getByRole('link', { name: linkName, exact: true }).click(); // retries, saves, then navigates
      await expect(page).toHaveURL(url);
      await page.goto('#/studio');
      await page.getByRole('list', { name: /./ }).getByRole('link').first().click();
      await expect(instruction(page)).toHaveValue(text);
    });
  }

  test('failure that happens on the exit click itself (no earlier autosave failure) is handled the same way', async ({ page }) => {
    await openEditorWithStep(page, 'Nav: immediate');
    await setFailWrites(page, true);
    await instruction(page).fill('Typed just before leaving');
    await page.getByRole('link', { name: 'My guides', exact: true }).click(); // within the 500 ms autosave debounce
    await expectHeldInEditor(page, 'Typed just before leaving');
    expect(await firstInstruction(page)).toBe('');
  });

  test('browser Back: the URL is put back, nothing is lost, history does not loop; Back and Forward work once saved', async ({ page }) => {
    const text = await failedUnsavedEdit(page, 'Nav: browser back');
    const editHash = await currentHash(page);
    const length = await historyLength(page);

    await page.goBack();
    await expectHeldInEditor(page, text);
    expect(await currentHash(page)).toBe(editHash);
    await page.goBack(); // pressing it again is blocked again, not a loop and not a leak
    await expectHeldInEditor(page, text);
    expect(await currentHash(page)).toBe(editHash);
    expect(await historyLength(page)).toBe(length);
    expect(await firstInstruction(page)).toBe('');
    await qaShot(page, `held-browser-back-${test.info().project.name}`);

    await setFailWrites(page, false);
    await retryButton(page).click();
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await page.goBack(); // clean: no dialog, no banner
    await expect(page).toHaveURL(/#\/studio\/new$/);
    await expect(page.getByText(HELD_TEXT)).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL(/#\/edit\//);
    await expect(instruction(page)).toHaveValue(text);
    expect(await historyLength(page)).toBe(length);
  });

  test('browser Back then "Leave without saving" goes to the page Back pointed at and stores nothing', async ({ page }) => {
    const text = await failedUnsavedEdit(page, 'Nav: back then leave');
    await page.goBack();
    await expectHeldInEditor(page, text);
    await leaveButton(page).click();
    await expect(page).toHaveURL(/#\/studio\/new$/);
    await expect(page.getByRole('heading', { name: 'My guides', level: 1 })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/#\/edit\//);
    await expect(instruction(page)).toHaveValue(''); // the discarded edit did not come back
    expect((await storedGuides(page)).length).toBe(1);
  });

  test('a pending cover (redaction): every exit keeps it in the editor until it is stored', async ({ page }) => {
    await openEditorWithStep(page, 'Nav: pending cover');
    await setFailWrites(page, true);
    await page.getByRole('button', { name: 'Cover private info' }).click();
    await drag(page, [0.2, 0.4], [0.7, 0.55]);
    await expect(page.getByTestId('redaction-box')).toHaveCount(1);
    await expect(status(page)).toHaveAttribute('data-state', 'error');
    await page.getByRole('link', { name: 'My guides', exact: true }).click();
    await expect(page).toHaveURL(/#\/edit\//);
    await expect(page.getByText(HELD_TEXT)).toBeVisible();
    await expect(page.getByTestId('redaction-box')).toHaveCount(1);
    expect((await storedGuides(page))[0]?.redactions).toBe(0);
    await page.goBack();
    await expect(page).toHaveURL(/#\/edit\//);
    await expect(page.getByTestId('redaction-box')).toHaveCount(1);
    await qaShot(page, `held-pending-cover-${test.info().project.name}`);

    await setFailWrites(page, false);
    await retryButton(page).click();
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    expect((await storedGuides(page))[0]?.redactions).toBe(1);
  });

  test('a cover drawn a moment before leaving is stored first (no waiting for autosave)', async ({ page }) => {
    await openEditorWithStep(page, 'Nav: cover then exit');
    await page.getByRole('button', { name: 'Cover private info' }).click();
    await drag(page, [0.2, 0.4], [0.7, 0.55]);
    await expect(page.getByTestId('redaction-box')).toHaveCount(1);
    await page.getByRole('link', { name: 'My guides', exact: true }).click();
    await expect(page).toHaveURL(/#\/studio$/);
    await expect.poll(async () => (await storedGuides(page))[0]?.redactions).toBe(1);
  });
});

test.describe('explicit "Leave without saving"', () => {
  test('discards only the unsaved edit: another guide is untouched, nothing is written later, nothing comes back', async ({ page }) => {
    await openEditorWithStep(page, 'Other guide', 'nav-b.png');
    await instruction(page).fill('B stays');
    await expectStored(page, (gs) => gs.some((g) => g.instructions.includes('B stays')));
    await createGuide(page, 'Guide A');
    await addScreenshots(page, [writeTmp('nav-a.png', patternPng(200, 300))]);
    await expectStored(page, (gs) => gs.length === 2 && gs.every((g) => g.instructions.length > 0));
    await setFailWrites(page, true);
    await instruction(page).fill('A discarded');
    await expect(status(page)).toHaveAttribute('data-state', 'error');
    await page.getByRole('link', { name: 'My guides', exact: true }).click();
    await expectHeldInEditor(page, 'A discarded');
    await expect(page.getByText('Leaving now discards the changes that are not saved. Anything already saved stays as it is.')).toBeVisible();

    // Storage works again BEFORE leaving, so any write that still happened would succeed and be visible.
    await setFailWrites(page, false);
    const before = await writes(page);
    await leaveButton(page).click();
    await expect(page).toHaveURL(/#\/studio$/);
    await page.waitForTimeout(1200); // longer than the 500 ms autosave debounce: a stray unmount/autosave write would have landed
    expect(await writes(page)).toBe(before);
    const guides = await storedGuides(page);
    expect(guides.map((g) => g.title).sort()).toEqual(['Guide A', 'Other guide']);
    expect(guides.find((g) => g.title === 'Guide A')?.instructions).toEqual(['']);
    expect(guides.find((g) => g.title === 'Other guide')?.instructions).toEqual(['B stays']);
  });

  test('works while storage is still failing, and "Keep editing" withdraws the request', async ({ page }) => {
    const text = await failedUnsavedEdit(page, 'Nav: keep or leave');
    await page.getByRole('link', { name: 'My guides', exact: true }).click();
    await expectHeldInEditor(page, text);
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(leaveButton(page)).toHaveCount(0);
    await expect(page.getByText(HELD_TEXT)).toHaveCount(0);
    await expect(retryButton(page)).toBeVisible(); // the failure itself is still reported
    await expect(page).toHaveURL(/#\/edit\//);

    await page.getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(leaveButton(page)).toBeVisible();
    await leaveButton(page).click();
    await expect(page).toHaveURL(/#\/privacy$/);
    expect(await firstInstruction(page)).toBe('');
  });

  test('keyboard only: Enter on a link, focus lands on Retry, Tab reaches every choice, Enter leaves', async ({ page }) => {
    const text = await failedUnsavedEdit(page, 'Nav: keyboard');
    await page.getByRole('link', { name: 'All guides' }).focus();
    await page.keyboard.press('Enter');
    await expectHeldInEditor(page, text); // includes: Retry has focus
    for (const name of ['Download a backup file', 'Keep editing', 'Leave without saving']) {
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name })).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/studio$/);
  });
});

test.describe('clean navigation stays quiet', () => {
  test('saved work: links, Back and Forward just work, with no banner and no extra history entries', async ({ page }) => {
    await openEditorWithStep(page, 'Nav: clean');
    await instruction(page).fill('All saved');
    await expectStored(page, (gs) => gs[0]?.instructions[0] === 'All saved');
    const editHash = await currentHash(page);
    await page.getByRole('link', { name: 'My guides', exact: true }).click();
    await expect(page).toHaveURL(/#\/studio$/);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(editHash.replace(/[/#]/g, '\\$&') + '$'));
    await page.goForward();
    await expect(page).toHaveURL(/#\/studio$/);
    await page.goBack();
    await page.getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page).toHaveURL(/#\/privacy$/);
    const log = await readNavLog(page);
    expect(log.hashes.filter((h) => h.startsWith('#/preview'))).toEqual([]);
  });
});

test.describe('the newest navigation request wins; stale completions never navigate', () => {
  async function stuckEdit(page: Page, title: string) {
    await openEditorWithStep(page, title);
    await hold(page);
    await instruction(page).fill('queued edit');
    await expect(status(page)).toHaveAttribute('data-state', 'saving'); // the autosave is now stuck behind the hold
  }

  test('Preview, then Privacy before the save finishes: ends on Privacy; the old Preview never fires', async ({ page }) => {
    await stuckEdit(page, 'Nav: stale preview');
    await previewLink(page).click();
    await page.getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(status(page)).not.toHaveAttribute('data-state', 'saved');
    await expect(page).toHaveURL(/#\/edit\//); // both requests wait for the stored edit

    await release(page);
    await expect(page).toHaveURL(/#\/privacy$/);
    await expect.poll(() => firstInstruction(page)).toBe('queued edit');
    const log = await readNavLog(page);
    expect(log.hashes.filter((h) => h.startsWith('#/preview'))).toEqual([]);
    expect(await currentHash(page)).toBe('#/privacy');

    // A newer editor session afterwards is not hijacked by anything left over.
    await createGuide(page, 'Nav: newer session');
    const url = page.url();
    await expect(page.getByTestId('dropzone')).toBeVisible();
    expect(page.url()).toBe(url);
    expect((await readNavLog(page)).hashes.filter((h) => h.startsWith('#/preview'))).toEqual([]);
  });

  test('reproduction of the old defect: after the delayed save completes, the app is on the LAST destination, never bounced to Preview', async ({ page }) => {
    // Only end-state assertions, so that on the pre-fix code this fails because of the stale redirect itself.
    await stuckEdit(page, 'Nav: stale redirect');
    await previewLink(page).click();
    await page.getByRole('link', { name: 'Privacy', exact: true }).click();
    await release(page);
    await expect.poll(() => firstInstruction(page)).toBe('queued edit'); // the delayed save has completed
    await expect(page).toHaveURL(/#\/privacy$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How TapTrail handles your screenshots');
    expect((await readNavLog(page)).hashes.filter((h) => h.startsWith('#/preview'))).toEqual([]);
  });
  test('Privacy, then Preview: the later choice (Preview) wins and shows the saved edit', async ({ page }) => {
    await stuckEdit(page, 'Nav: latest intent');
    await page.getByRole('link', { name: 'Privacy', exact: true }).click();
    await previewLink(page).click();
    await release(page);
    await expect(page).toHaveURL(/#\/preview\//);
    await expect(previewText(page)).toHaveText('queued edit');
    expect((await readNavLog(page)).hashes.filter((h) => h === '#/privacy')).toEqual([]);
  });

  test('Preview, Studio, Preview again: exactly one navigation, to the last choice', async ({ page }) => {
    await stuckEdit(page, 'Nav: three requests');
    const length = await historyLength(page);
    await previewLink(page).click();
    await page.getByRole('link', { name: 'My guides', exact: true }).click();
    await previewLink(page).click();
    await release(page);
    await expect(page).toHaveURL(/#\/preview\//);
    await expect(previewText(page)).toHaveText('queued edit');
    const log = await readNavLog(page);
    expect(log.hashes.filter((h) => h === '#/studio')).toEqual([]);
    expect(log.hashes.filter((h) => h.startsWith('#/preview')).length).toBe(1);
    expect(await historyLength(page)).toBe(length + 1);
  });

  test('repeated clicks on Preview while saving make a single history entry', async ({ page }) => {
    await stuckEdit(page, 'Nav: repeated');
    const length = await historyLength(page);
    await previewLink(page).evaluate((a: HTMLAnchorElement) => {
      a.click();
      a.click();
      a.click();
    });
    await release(page);
    await expect(page).toHaveURL(/#\/preview\//);
    await expect(previewText(page)).toHaveText('queued edit');
    expect((await readNavLog(page)).hashes.filter((h) => h.startsWith('#/preview')).length).toBe(1);
    expect(await historyLength(page)).toBe(length + 1);
  });

  test('browser Back during a slow save waits for it, then goes; it does not go before the save', async ({ page }) => {
    await stuckEdit(page, 'Nav: back while saving');
    await page.goBack();
    await expect(page).toHaveURL(/#\/edit\//); // URL put back while the save is pending
    await expect(status(page)).not.toHaveAttribute('data-state', 'saved');
    await release(page);
    await expect(page).toHaveURL(/#\/studio\/new$/);
    await expect.poll(() => firstInstruction(page)).toBe('queued edit');
  });

  test('browser Back with a FAST successful save (no artificial delay) still reaches the previous page', async ({ page }) => {
    await openEditorWithStep(page, 'Nav: fast back');
    const before = await currentHash(page);
    await instruction(page).fill('fast edit'); // autosave (500 ms) has not run: Back is the first thing that saves
    await page.goBack();
    await expect(page).not.toHaveURL(before);
    await expect(page).toHaveURL(/#\/studio\/new$/);
    await expect(page.getByTestId('save-status')).toHaveCount(0); // the editor is gone
    expect(await firstInstruction(page)).toBe('fast edit');
    await page.goForward(); // Forward returns to the editor with the stored edit
    await expect(instruction(page)).toHaveValue('fast edit');
  });
});

test.describe('modified clicks on Preview (Ctrl/Cmd-click and middle-click)', () => {
  test('with pending edits they only trigger the save (nothing opens, nothing navigates later); with saved edits the browser handles them', async ({ page }) => {
    await openEditorWithStep(page, 'Nav: modified clicks');
    await hold(page);
    await instruction(page).fill('modified click edit');
    await expect(status(page)).toHaveAttribute('data-state', 'saving');
    const pagesBefore = page.context().pages().length;

    await previewLink(page).click({ modifiers: ['ControlOrMeta'] });
    await previewLink(page).click({ button: 'middle' });
    let log = await readNavLog(page);
    const ctrl = log.clicks.filter((c) => c.type === 'click' && c.ctrl);
    const middle = log.clicks.filter((c) => c.button === 1);
    expect(ctrl.length, 'a Ctrl/Cmd-click reaches the click handler path').toBe(1);
    expect(ctrl[0]?.prevented, 'pending edits: the new-tab open is suppressed').toBe(true);
    expect(middle.length, 'a middle-click is its own event (auxclick), not click').toBeGreaterThan(0);
    expect(middle.every((c) => c.type === 'auxclick' && c.prevented), 'pending edits: middle-click open is suppressed too').toBe(true);

    await release(page);
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await expect(page).toHaveURL(/#\/edit\//); // no navigation after the asynchronous wait
    expect(page.context().pages().length, 'no tab or popup opened by the async completion').toBe(pagesBefore);

    // Saved now: the same gesture is left to the browser (not prevented).
    await previewLink(page).click({ modifiers: ['ControlOrMeta'] });
    log = await readNavLog(page);
    const last = log.clicks.filter((c) => c.type === 'click' && c.ctrl).at(-1);
    expect(last?.prevented, 'saved content: ordinary new-tab behaviour is preserved').toBe(false);
    await expect(page).toHaveURL(/#\/edit\//);
    for (const extra of page.context().pages().filter((p) => p !== page)) {
      await expect(extra.locator('body')).toBeAttached();
      await extra.close();
    }
  });
});