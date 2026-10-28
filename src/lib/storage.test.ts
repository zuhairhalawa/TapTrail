import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  addGuideWithImages, closeDbForTests, deleteGuide, getGuide, getGuideImages, getImage, isQuotaError, listGuides, pruneOrphanImages, putImage,
  saveGuide, StorageError,
} from './storage';
import { addStep, createGuide, createStep } from './guideOps';
import type { StoredImage } from './types';

const img = (id: string, guideId: string): StoredImage => ({ id, guideId, mime: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]).buffer, width: 10, height: 20 });

beforeEach(async () => {
  await closeDbForTests();
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => vi.restoreAllMocks());

describe('IndexedDB persistence', () => {
  it('saves a guide and resumes it after the connection is reopened (page reload)', async () => {
    let g = createGuide({ title: 'Persist me', lang: 'en' });
    g = addStep(g, createStep({ imageId: 'i1', width: 10, height: 20, instruction: 'hello' }));
    await putImage(img('i1', g.id));
    await saveGuide(g);

    await closeDbForTests(); // simulates a reload: the in-memory connection is gone
    const loaded = await getGuide(g.id);
    expect(loaded?.title).toBe('Persist me');
    expect(loaded?.steps[0]?.instruction).toBe('hello');
    expect(new Uint8Array((await getImage('i1'))!.bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('lists guides newest first and supports rename (re-save)', async () => {
    const a = createGuide({ title: 'A', lang: 'en' }, 1000);
    const b = createGuide({ title: 'B', lang: 'en' }, 2000);
    await saveGuide(a);
    await saveGuide(b);
    expect((await listGuides()).map((g) => g.title)).toEqual(['B', 'A']);
    await saveGuide({ ...a, title: 'A renamed', updatedAt: 3000 });
    expect((await listGuides()).map((g) => g.title)).toEqual(['A renamed', 'B']);
  });

  it('deletes a guide together with its images only', async () => {
    const a = createGuide({ title: 'A', lang: 'en' });
    const b = createGuide({ title: 'B', lang: 'en' });
    await saveGuide(a);
    await saveGuide(b);
    await putImage(img('a1', a.id));
    await putImage(img('b1', b.id));
    await deleteGuide(a.id);
    expect(await getGuide(a.id)).toBeUndefined();
    expect(await getGuideImages(a.id)).toEqual([]);
    expect((await getGuideImages(b.id)).map((i) => i.id)).toEqual(['b1']);
  });

  it('prunes images no step refers to', async () => {
    let g = createGuide({ title: 'A', lang: 'en' });
    g = addStep(g, createStep({ imageId: 'keep', width: 1, height: 1 }));
    await putImage(img('keep', g.id));
    await putImage(img('orphan', g.id));
    expect(await pruneOrphanImages(g)).toBe(1);
    expect((await getGuideImages(g.id)).map((i) => i.id)).toEqual(['keep']);
  });
});

describe('browser storage failures', () => {
  it('turns a quota error while saving into a StorageError(quota) instead of losing it silently', async () => {
    const g = createGuide({ title: 'Big', lang: 'en' });
    await saveGuide(g); // opens the db
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const err = await saveGuide({ ...g, title: 'Bigger' }).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err.kind).toBe('quota');
    await expect(putImage(img('x', g.id))).rejects.toMatchObject({ kind: 'quota' });
  });

  it('reports other failures as unknown and unavailable storage as unavailable', async () => {
    const g = createGuide({ title: 'X', lang: 'en' });
    await saveGuide(g);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('disk on fire');
    });
    await expect(saveGuide(g)).rejects.toMatchObject({ kind: 'unknown' });
    vi.restoreAllMocks();
    await closeDbForTests();
    vi.stubGlobal('indexedDB', undefined);
    await expect(listGuides()).rejects.toMatchObject({ kind: 'unavailable' });
    vi.unstubAllGlobals();
  });

  it('recognizes quota errors across browsers', () => {
    expect(isQuotaError(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new Error('Storage quota exceeded'))).toBe(true);
    expect(isQuotaError(new Error('nope'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});
describe('addGuideWithImages (atomic import write)', () => {
  it('stores the guide and all images together', async () => {
    let g = createGuide({ title: 'New', lang: 'en' });
    g = addStep(g, createStep({ imageId: 'n1', width: 10, height: 20 }));
    g = addStep(g, createStep({ imageId: 'n2', width: 10, height: 20 }));
    await addGuideWithImages(g, [img('n1', g.id), img('n2', g.id)]);
    expect((await getGuide(g.id))?.steps).toHaveLength(2);
    expect((await getGuideImages(g.id)).map((i) => i.id).sort()).toEqual(['n1', 'n2']);
  });

  it('never overwrites an existing guide or image: a colliding id fails and rolls back the whole attempt', async () => {
    const other = createGuide({ title: 'Existing', lang: 'en' });
    await saveGuide(other);
    await putImage({ ...img('shared', other.id), bytes: new Uint8Array([9, 9]).buffer });

    // colliding image id
    const g1 = createGuide({ title: 'Collides on image', lang: 'en' });
    await expect(addGuideWithImages(g1, [img('fresh', g1.id), img('shared', g1.id)])).rejects.toBeInstanceOf(StorageError);
    expect(await getGuide(g1.id)).toBeUndefined();
    expect(await getImage('fresh')).toBeUndefined();
    expect(new Uint8Array((await getImage('shared'))!.bytes)).toEqual(new Uint8Array([9, 9]));

    // colliding guide id
    await expect(addGuideWithImages({ ...other, title: 'Hijack' }, [img('fresh2', other.id)])).rejects.toBeInstanceOf(StorageError);
    expect((await getGuide(other.id))?.title).toBe('Existing');
    expect(await getImage('fresh2')).toBeUndefined();
  });
});