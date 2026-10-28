import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Guide, StoredImage } from './types';

interface TapTrailDB extends DBSchema {
  guides: { key: string; value: Guide; indexes: { 'by-updated': number } };
  images: { key: string; value: StoredImage; indexes: { 'by-guide': string } };
}

export type StorageErrorKind = 'quota' | 'unavailable' | 'unknown';

export class StorageError extends Error {
  readonly kind: StorageErrorKind;
  constructor(kind: StorageErrorKind, cause?: unknown) {
    super(`storage:${kind}`, { cause });
    this.name = 'StorageError';
    this.kind = kind;
  }
}

export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: string; code?: number; message?: string; cause?: unknown };
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    /quota/i.test(err.message ?? '') ||
    (err.cause !== undefined && err.cause !== e && isQuotaError(err.cause))
  );
}

function toStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  if (isQuotaError(e)) return new StorageError('quota', e);
  return new StorageError('unknown', e);
}

const DB_NAME = 'taptrail';
let dbPromise: Promise<IDBPDatabase<TapTrailDB>> | null = null;

function db(): Promise<IDBPDatabase<TapTrailDB>> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new StorageError('unavailable'));
    }
    dbPromise = openDB<TapTrailDB>(DB_NAME, 1, {
      upgrade(database) {
        const guides = database.createObjectStore('guides', { keyPath: 'id' });
        guides.createIndex('by-updated', 'updatedAt');
        const images = database.createObjectStore('images', { keyPath: 'id' });
        images.createIndex('by-guide', 'guideId');
      },
    }).catch((e) => {
      dbPromise = null;
      throw new StorageError('unavailable', e);
    });
  }
  return dbPromise;
}

async function run<T>(fn: (d: IDBPDatabase<TapTrailDB>) => Promise<T>): Promise<T> {
  try {
    return await fn(await db());
  } catch (e) {
    throw toStorageError(e);
  }
}

/** Test helper: forget the cached connection. */
export async function closeDbForTests(): Promise<void> {
  if (dbPromise) {
    const d = await dbPromise.catch(() => null);
    d?.close();
  }
  dbPromise = null;
}

export const listGuides = (): Promise<Guide[]> =>
  run(async (d) => (await d.getAll('guides')).sort((a, b) => b.updatedAt - a.updatedAt));

export const getGuide = (id: string): Promise<Guide | undefined> => run((d) => d.get('guides', id));

export const saveGuide = (guide: Guide): Promise<void> =>
  run(async (d) => {
    await d.put('guides', guide);
  });

export const putImage = (img: StoredImage): Promise<void> =>
  run(async (d) => {
    await d.put('images', img);
  });

export const getImage = (id: string): Promise<StoredImage | undefined> => run((d) => d.get('images', id));

export const getGuideImages = (guideId: string): Promise<StoredImage[]> =>
  run((d) => d.getAllFromIndex('images', 'by-guide', guideId));

/** Delete a guide and every image that belongs to it in one transaction. */
export const deleteGuide = (id: string): Promise<void> =>
  run(async (d) => {
    const tx = d.transaction(['guides', 'images'], 'readwrite');
    const keys = await tx.objectStore('images').index('by-guide').getAllKeys(id);
    await Promise.all(keys.map((k) => tx.objectStore('images').delete(k)));
    await tx.objectStore('guides').delete(id);
    await tx.done;
  });

/** Remove images that no step refers to any more (e.g. after deleting a step). */
export const pruneOrphanImages = (guide: Guide): Promise<number> =>
  run(async (d) => {
    const used = new Set(guide.steps.map((s) => s.imageId));
    const keys = await d.getAllKeysFromIndex('images', 'by-guide', guide.id);
    const orphans = keys.filter((k) => !used.has(k));
    await Promise.all(orphans.map((k) => d.delete('images', k)));
    return orphans.length;
  });

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || est.usage === undefined || est.quota === undefined) return null;
    return { usage: est.usage, quota: est.quota };
  } catch {
    return null;
  }
}

export function requestPersistence(): void {
  void navigator.storage?.persist?.().catch(() => undefined);
}