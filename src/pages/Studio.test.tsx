import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { I18nProvider } from '../i18n/I18n';
import { ThemeProvider } from '../theme';
import { Studio } from './Studio';
import { closeDbForTests, getGuide, listGuides, saveGuide } from '../lib/storage';
import { createGuide } from '../lib/guideOps';
import { stringifyProject } from '../lib/validate';
import { fakeImageDataUrl } from '../test/fixtures';

const ui = (openNew = false, lang: 'en' | 'ar' = 'en') => (
  <ThemeProvider>
    <I18nProvider initial={lang}>
      <Studio openNew={openNew} />
    </I18nProvider>
  </ThemeProvider>
);

beforeEach(async () => {
  await closeDbForTests();
  globalThis.indexedDB = new IDBFactory();
  window.location.hash = '#/studio';
});
afterEach(cleanup);

describe('Studio: guide management', () => {
  it('shows a helpful empty state', async () => {
    render(ui());
    expect(await screen.findByText('No guides yet')).toBeInTheDocument();
  });

  it('creates a named guide with a description and persists it', async () => {
    const user = userEvent.setup();
    render(ui(true));
    const dialog = await screen.findByRole('dialog', { name: 'Create a new guide', hidden: true });
    const name = within(dialog).getByLabelText('Guide name');
    await user.click(within(dialog).getByRole('button', { name: 'Create guide', hidden: true }));
    expect(await within(dialog).findByRole('alert', { hidden: true })).toHaveTextContent('Please give your guide a name.');
    await user.type(name, 'Wi-Fi help');
    await user.type(within(dialog).getByLabelText('Short description (optional)'), 'For grandma');
    await user.click(within(dialog).getByRole('button', { name: 'Create guide', hidden: true }));
    await waitFor(async () => expect((await listGuides())[0]?.title).toBe('Wi-Fi help'));
    expect((await listGuides())[0]).toMatchObject({ description: 'For grandma', steps: [] });
    expect(window.location.hash).toMatch(/^#\/edit\//);
  });

  it('lists saved guides and renames one', async () => {
    const g = createGuide({ title: 'Old name', lang: 'en' });
    await saveGuide(g);
    const user = userEvent.setup();
    render(ui());
    expect(await screen.findByRole('link', { name: 'Old name' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Rename/ }));
    const input = await screen.findByLabelText('Guide name');
    await user.clear(input);
    await user.type(input, 'New name');
    await user.click(screen.getByRole('button', { name: 'Save', hidden: true }));
    await waitFor(async () => expect((await getGuide(g.id))?.title).toBe('New name'));
  });

  it('asks for confirmation before deleting, and cancel keeps the guide', async () => {
    const g = createGuide({ title: 'Keep me', lang: 'en' });
    await saveGuide(g);
    const user = userEvent.setup();
    render(ui());
    await user.click(await screen.findByRole('button', { name: /Delete/ }));
    expect(await screen.findByText('Delete this guide?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(await getGuide(g.id)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Delete/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete guide', hidden: true }));
    await waitFor(async () => expect(await getGuide(g.id)).toBeUndefined());
    expect(await screen.findByText('No guides yet')).toBeInTheDocument();
  });

  it('rejects malicious or invalid project files with a clear message and imports nothing', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(ui());
    const input = await screen.findByTestId('import-input');
    await user.upload(input, new File(['<script>alert(1)</script>'], 'x.json', { type: 'application/json' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not look like a TapTrail project file');
    const bad = JSON.parse(stringifyProject({ title: 't', description: '', lang: 'en', steps: [{ instruction: 'x', image: fakeImageDataUrl(), width: 1, height: 1, hotspot: null }] }));
    bad.guide.steps[0].image = 'data:text/html;base64,PGgxPg==';
    await user.upload(input, new File([JSON.stringify(bad)], 'y.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not a valid PNG, JPEG or WebP'));
    expect(await listGuides()).toEqual([]);
  });
});

describe('Studio: Arabic / RTL', () => {
  it('renders Arabic text and sets right-to-left direction', async () => {
    render(ui(false, 'ar'));
    expect(await screen.findByText('لا توجد أدلة بعد')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });
});