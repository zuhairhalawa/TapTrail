import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { closeDbForTests, getGuide, listGuides, putImage, saveGuide } from './storage';
import { addStep, createGuide, createStep } from './guideOps';
import { stringifyProject } from './validate';
import { fakeImageDataUrl } from '../test/fixtures';
import * as imageLib from './image';
import { LIMITS } from './types';
import { importProjectText } from './projectIO';

vi.mock('./image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./image')>()),
  processUpload: vi.fn(),
}));

const HOTSPOT = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };

function project(n: number): string {
  return stringifyProject({
    title: 'Imported',
    description: 'd',
    lang: 'en',
    steps: Array.from({ length: n }, (_, i) => ({
      instruction: `step ${i + 1}`,
      image: fakeImageDataUrl('png', i + 1),
      width: 10,
      height: 20,
      hotspot: i === 0 ? HOTSPOT : null,
    })),
  });
}

/** Every row of both stores, read straight from IndexedDB (bytes as plain arrays so they compare). */
async function snapshot() {
  await listGuides(); // makes sure the schema exists even if the app never wrote anything
  await closeDbForTests(); // fresh connection; the app reopens on demand
  const d = await openDB('taptrail');
  try {
    const guides = await d.getAll('guides');
    const images = (await d.getAll('images')).map((i: { id: string; guideId: string; mime: string; width: number; height: number; bytes: ArrayBuffer }) => ({
      ...i,
      bytes: Array.from(new Uint8Array(i.bytes)),
    }));
    return { guides: guides.sort((a, b) => a.id.localeCompare(b.id)), images: images.sort((a, b) => a.id.localeCompare(b.id)) };
  } finally {
    d.close();
  }
}

/** An unrelated guide with one image that must survive every failed or successful import untouched. */
async function seedUnrelated() {
  let g = createGuide({ title: 'Unrelated', lang: 'en' });
  g = addStep(g, createStep({ imageId: 'keep-1', width: 10, height: 20, instruction: 'keep me' }));
  await putImage({ id: 'keep-1', guideId: g.id, mime: 'image/png', bytes: new Uint8Array([7, 7, 7, 7]).buffer, width: 10, height: 20 });
  await saveGuide(g);
  return g;
}

let calls = 0;
let active = 0;
let maxActive = 0;
function decodeOk(failOnCall?: number) {
  calls = 0;
  active = 0;
  maxActive = 0;
  vi.mocked(imageLib.processUpload).mockImplementation(async () => {
    const n = ++calls;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 1));
    active--;
    if (n === failOnCall) throw new imageLib.ImageError('corrupt');
    return { blob: new Blob([new Uint8Array([n, n, n, n])], { type: 'image/png' }), mime: 'image/png', width: 10, height: 20 };
  });
}

const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

/** Make a write to `store` throw (simulated quota). `nth` = 0-based index among writes to that store. */
function failWrite(store: 'guides' | 'images', nth = 0, how: 'throw' | 'abort' = 'throw') {
  const seen = { guides: 0, images: 0 };
  for (const method of ['put', 'add'] as const) {
    const original = IDBObjectStore.prototype[method];
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, ...args: [unknown, IDBValidKey?]) {
      if (this.name === store) {
        if (seen[store]++ === nth) {
          if (how === 'throw') throw quota();
          const req = (original as (...a: unknown[]) => IDBRequest).apply(this, args);
          this.transaction.abort(); // what a browser does when the commit hits the quota
          return req;
        }
      }
      return (original as (...a: unknown[]) => IDBRequest).apply(this, args);
    } as typeof original);
  }
}

beforeEach(async () => {
  await closeDbForTests();
  globalThis.indexedDB = new IDBFactory();
  vi.mocked(imageLib.processUpload).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('importProjectText: success', () => {
  it('stores every image and the guide together, next to untouched unrelated data', async () => {
    const unrelated = await seedUnrelated();
    const before = await snapshot();
    decodeOk();
    const guide = await importProjectText(project(3), 'en');

    const after = await snapshot();
    expect(after.guides).toHaveLength(2);
    expect(after.images).toHaveLength(before.images.length + 3);
    // unrelated rows are byte-for-byte identical
    expect(after.guides.find((g) => g.id === unrelated.id)).toEqual(before.guides[0]);
    expect(after.images.find((i) => i.id === 'keep-1')).toEqual(before.images[0]);
    // the returned guide is what was persisted, and every step points at a stored image of this guide
    expect(await getGuide(guide.id)).toEqual(guide);
    expect(guide.steps).toHaveLength(3);
    expect(guide.steps.map((s) => s.instruction)).toEqual(['step 1', 'step 2', 'step 3']);
    expect(guide.steps[0]!.hotspot).toEqual(HOTSPOT);
    const mine = after.images.filter((i) => i.guideId === guide.id);
    expect(mine.map((i) => i.id).sort()).toEqual(guide.steps.map((s) => s.imageId).sort());
    expect(mine.map((i) => i.bytes[0]).sort()).toEqual([1, 2, 3]);
  });

  it('decodes one picture at a time (memory stays bounded)', async () => {
    decodeOk();
    await importProjectText(project(4), 'en');
    expect(calls).toBe(4);
    expect(maxActive).toBe(1);
  });
});

describe('importProjectText: a failure on a later step leaves nothing behind', () => {
  const expectUntouched = async (before: Awaited<ReturnType<typeof snapshot>>) => {
    const after = await snapshot();
    expect(after.images.map((i) => i.id)).toEqual(before.images.map((i) => i.id)); // no orphaned images
    expect(after).toEqual(before); // unrelated guide and image byte-for-byte unchanged
    expect((await listGuides()).map((g) => g.title)).toEqual(['Unrelated']);
  };

  it('decoder failure on the 2nd picture (1st is valid)', async () => {
    await seedUnrelated();
    const before = await snapshot();
    decodeOk(2);
    await expect(importProjectText(project(3), 'en')).rejects.toMatchObject({ code: 'corrupt' });
    expect(calls).toBe(2); // stopped at the failure, did not keep decoding
    await expectUntouched(before);
  });

  it('decoder failure on the last picture', async () => {
    await seedUnrelated();
    const before = await snapshot();
    decodeOk(3);
    await expect(importProjectText(project(3), 'en')).rejects.toMatchObject({ code: 'corrupt' });
    await expectUntouched(before);
  });

  it('quota error while storing the 2nd picture (1st stored fine)', async () => {
    await seedUnrelated();
    const before = await snapshot();
    decodeOk();
    failWrite('images', 1);
    await expect(importProjectText(project(3), 'en')).rejects.toMatchObject({ kind: 'quota' });
    vi.restoreAllMocks();
    await expectUntouched(before);
  });

  it('quota error that only surfaces when the storage transaction aborts (commit-time quota)', async () => {
    await seedUnrelated();
    const before = await snapshot();
    decodeOk();
    failWrite('images', 1, 'abort');
    await expect(importProjectText(project(3), 'en')).rejects.toBeDefined();
    vi.restoreAllMocks();
    await expectUntouched(before);
  });

  it('failure while saving the guide record itself', async () => {
    await seedUnrelated();
    const before = await snapshot();
    decodeOk();
    failWrite('guides', 0);
    await expect(importProjectText(project(3), 'en')).rejects.toMatchObject({ kind: 'quota' });
    vi.restoreAllMocks();
    await expectUntouched(before);
  });

  it('guide record aborted at commit time', async () => {
    await seedUnrelated();
    const before = await snapshot();
    decodeOk();
    failWrite('guides', 0, 'abort');
    await expect(importProjectText(project(3), 'en')).rejects.toBeDefined();
    vi.restoreAllMocks();
    await expectUntouched(before);
  });

  it('works on an empty database too, and a retry after the failure succeeds cleanly', async () => {
    decodeOk(2);
    await expect(importProjectText(project(2), 'en')).rejects.toMatchObject({ code: 'corrupt' });
    expect((await snapshot()).images).toEqual([]);
    decodeOk();
    const g = await importProjectText(project(2), 'en');
    const after = await snapshot();
    expect(after.guides.map((x) => x.id)).toEqual([g.id]);
    expect(after.images).toHaveLength(2);
  });
});
describe('importProjectText: bounded memory', () => {
  it('refuses to hold more re-encoded picture data than the import limit, and writes nothing', async () => {
    await seedUnrelated();
    const before = await snapshot();
    let n = 0;
    vi.mocked(imageLib.processUpload).mockImplementation(async () => {
      n++;
      // a picture whose re-encoded size is (just over) half the cap, so the 2nd one crosses it
      const half = Math.floor(LIMITS.maxImportFileBytes / 2) + 1;
      const blob = { arrayBuffer: async () => ({ byteLength: half }) } as unknown as Blob;
      return { blob, mime: 'image/png', width: 10, height: 20 };
    });
    await expect(importProjectText(project(5), 'en')).rejects.toMatchObject({ code: 'too_large' });
    expect(n).toBe(2); // stopped as soon as the cap was crossed
    expect(await snapshot()).toEqual(before);
  });
});