import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { I18nProvider } from '../i18n/I18n';
import { ThemeProvider } from '../theme';
import { Studio } from './Studio';
import { closeDbForTests, getGuide, getImage, listGuides, putImage, saveGuide } from '../lib/storage';
import { addStep, createGuide, createStep, updateStep } from '../lib/guideOps';
import * as imageLib from '../lib/image';
import type { Rect } from '../lib/types';
import { openDB } from 'idb';
import { stringifyProject } from '../lib/validate';
import { fakeImageDataUrl } from '../test/fixtures';

vi.mock('../lib/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/image')>()),
  bakeRedactions: vi.fn(),
  processUpload: vi.fn(),
}));

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

describe('Studio: thumbnails and pending redactions', () => {
  const ORIGINAL = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const BAKED = new Uint8Array([9, 9, 9, 9]);
  const COVER: Rect[] = [{ x: 0.2, y: 0.05, w: 0.6, h: 0.12 }];

  const blobs = new Map<string, Blob>();
  let revoked: string[] = [];
  let seq = 0;

  const readBytes = (b: Blob) =>
    new Promise<number[]>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(Array.from(new Uint8Array(r.result as ArrayBuffer)));
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(b);
    });

  const seed = async (redactions: Rect[]) => {
    let g = createGuide({ title: 'Has secrets', lang: 'en' });
    g = addStep(g, createStep({ imageId: 'img-1', width: 10, height: 20 }));
    g = updateStep(g, g.steps[0]!.id, { redactions });
    await putImage({ id: 'img-1', guideId: g.id, mime: 'image/png', bytes: ORIGINAL.slice().buffer, width: 10, height: 20 });
    await saveGuide(g);
    return g;
  };

  beforeEach(() => {
    blobs.clear();
    revoked = [];
    seq = 0;
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      const u = `blob:test/${++seq}`;
      blobs.set(u, b as Blob);
      return u;
    });
    URL.revokeObjectURL = vi.fn((u: string) => {
      revoked.push(u);
    });
    vi.mocked(imageLib.bakeRedactions).mockReset();
    vi.mocked(imageLib.bakeRedactions).mockResolvedValue({ blob: new Blob([BAKED], { type: 'image/png' }), mime: 'image/png', width: 10, height: 20 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const thumb = (c: HTMLElement) => c.querySelector('li img') as HTMLImageElement | null;

  it('displays the REDACTED picture, never the original bytes, when the first step has pending covers', async () => {
    await seed(COVER);
    const { container } = render(ui());
    await waitFor(() => expect(thumb(container)).not.toBeNull());
    const src = thumb(container)!.getAttribute('src')!;
    expect(await readBytes(blobs.get(src)!)).toEqual(Array.from(BAKED));
    // Every object URL ever created for display holds only baked bytes (the original was never exposed).
    for (const b of blobs.values()) expect(await readBytes(b)).not.toEqual(Array.from(ORIGINAL));
    // The baker got the original bytes and exactly the saved covers.
    const [blobArg, rects] = vi.mocked(imageLib.bakeRedactions).mock.calls[0]!;
    expect(await readBytes(blobArg)).toEqual(Array.from(ORIGINAL));
    expect(rects).toEqual(COVER);
  });

  it('does not touch the editable draft: stored bytes and pending covers are unchanged', async () => {
    const g = await seed(COVER);
    const { container } = render(ui());
    await waitFor(() => expect(thumb(container)).not.toBeNull());
    expect(Array.from(new Uint8Array((await getImage('img-1'))!.bytes))).toEqual(Array.from(ORIGINAL));
    const saved = await getGuide(g.id);
    expect(saved?.steps[0]?.redactions).toEqual(COVER);
    expect(saved).toEqual(g);
  });

  it('keeps showing the stored picture, without re-encoding, when there is nothing to cover', async () => {
    await seed([]);
    const { container } = render(ui());
    await waitFor(() => expect(thumb(container)).not.toBeNull());
    expect(await readBytes(blobs.get(thumb(container)!.getAttribute('src')!)!)).toEqual(Array.from(ORIGINAL));
    expect(imageLib.bakeRedactions).not.toHaveBeenCalled();
  });

  it('fails closed: if covering fails the card shows a placeholder, never the unredacted original', async () => {
    await seed(COVER);
    vi.mocked(imageLib.bakeRedactions).mockRejectedValue(new imageLib.ImageError('corrupt'));
    const { container } = render(ui());
    expect(await screen.findByRole('link', { name: 'Has secrets' })).toBeInTheDocument();
    await waitFor(() => expect(imageLib.bakeRedactions).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(thumb(container)).toBeNull();
    for (const b of blobs.values()) expect(await readBytes(b)).not.toEqual(Array.from(ORIGINAL));
    expect(screen.queryByRole('alert')).toBeNull(); // the guide list itself still works
  });

  it('revokes every thumbnail object URL on reload and on unmount', async () => {
    await seed(COVER);
    const user = userEvent.setup();
    const { container, unmount } = render(ui());
    await waitFor(() => expect(thumb(container)).not.toBeNull());
    const first = thumb(container)!.getAttribute('src')!;

    // A rename reloads the list: the previous URL must be released and the new one must be live.
    await user.click(screen.getByRole('button', { name: /Rename/ }));
    const input = await screen.findByLabelText('Guide name');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save', hidden: true }));
    await waitFor(() => expect(revoked).toContain(first));
    await waitFor(() => expect(thumb(container)?.getAttribute('src')).not.toBe(first));
    const live = thumb(container)!.getAttribute('src')!;
    expect([...blobs.keys()].filter((u) => !revoked.includes(u))).toEqual([live]);

    unmount();
    expect([...blobs.keys()].filter((u) => !revoked.includes(u))).toEqual([]);
  });

  it('does not leak a thumbnail that finishes covering after the page was left', async () => {
    await seed(COVER);
    let release!: (v: Awaited<ReturnType<typeof imageLib.bakeRedactions>>) => void;
    vi.mocked(imageLib.bakeRedactions).mockReturnValue(new Promise((r) => (release = r)));
    const { unmount } = render(ui());
    await waitFor(() => expect(imageLib.bakeRedactions).toHaveBeenCalled());
    unmount();
    release({ blob: new Blob([BAKED], { type: 'image/png' }), mime: 'image/png', width: 10, height: 20 });
    await new Promise((r) => setTimeout(r, 50));
    expect([...blobs.keys()].filter((u) => !revoked.includes(u))).toEqual([]);
  });
});

describe('Studio: importing a project is all-or-nothing', () => {
  const projectText = (n: number) =>
    stringifyProject({
      title: 'Imported guide',
      description: '',
      lang: 'en',
      steps: Array.from({ length: n }, (_, i) => ({ instruction: `s${i + 1}`, image: fakeImageDataUrl('png', i + 1), width: 10, height: 20, hotspot: null })),
    });
  const file = (n: number) => new File([projectText(n)], 'p.json', { type: 'application/json' });

  const imageCount = async () => {
    await listGuides(); // ensure schema
    await closeDbForTests();
    const d = await openDB('taptrail');
    try {
      return await d.count('images');
    } finally {
      d.close();
    }
  };

  const decode = (failOn?: number) => {
    let n = 0;
    vi.mocked(imageLib.processUpload).mockReset();
    vi.mocked(imageLib.processUpload).mockImplementation(async () => {
      if (++n === failOn) throw new imageLib.ImageError('corrupt');
      return { blob: new Blob([new Uint8Array([n, n, n, n])], { type: 'image/png' }), mime: 'image/png', width: 10, height: 20 };
    });
  };

  afterEach(() => vi.restoreAllMocks());

  it('a later picture that cannot be decoded: clear error, no success message, no stray images, existing guide intact', async () => {
    const keep = createGuide({ title: 'Existing guide', lang: 'en' });
    await saveGuide(keep);
    decode(2);
    const user = userEvent.setup({ applyAccept: false });
    render(ui());
    await screen.findByRole('link', { name: 'Existing guide' });
    await user.upload(screen.getByTestId('import-input'), file(3));
    expect(await screen.findByRole('alert')).toHaveTextContent('This image could not be read');
    expect(screen.queryByRole('status')).toBeNull();
    expect(await imageCount()).toBe(0);
    expect((await listGuides()).map((g) => g.title)).toEqual(['Existing guide']);
  });

  it('a storage failure while saving: clear error, no success message, nothing stored', async () => {
    decode();
    const original = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'guides') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return original.apply(this, args);
    });
    const user = userEvent.setup({ applyAccept: false });
    render(ui());
    await screen.findByText('No guides yet');
    await user.upload(screen.getByTestId('import-input'), file(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('storage is full');
    expect(screen.queryByRole('status')).toBeNull();
    vi.restoreAllMocks();
    expect(await imageCount()).toBe(0);
    expect(await listGuides()).toEqual([]);
    // the failure is recoverable: the same file imports once storage works again
    decode();
    await user.upload(screen.getByTestId('import-input'), file(2));
    expect(await screen.findByRole('status')).toHaveTextContent('Imported "Imported guide".');
    expect(await imageCount()).toBe(2);
  });

  it('reports success only after the guide and every picture are stored', async () => {
    decode();
    const user = userEvent.setup({ applyAccept: false });
    render(ui());
    await screen.findByText('No guides yet');
    await user.upload(screen.getByTestId('import-input'), file(2));
    expect(await screen.findByRole('status')).toHaveTextContent('Imported "Imported guide".');
    const [g] = await listGuides();
    expect(g?.steps).toHaveLength(2);
    expect(await imageCount()).toBe(2);
    expect(await screen.findByRole('link', { name: 'Imported guide' })).toBeInTheDocument();
  });
});