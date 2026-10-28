import type { MessageKey } from '../i18n/en';
import { ImageError } from '../lib/image';
import { StorageError } from '../lib/storage';
import { ProjectError } from '../lib/validate';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Turn any thrown error into a friendly, translated sentence. */
export function describeError(e: unknown, t: T): string {
  if (e instanceof StorageError) {
    if (e.kind === 'quota') return t('error.quota');
    if (e.kind === 'unavailable') return t('error.storageUnavailable');
    return t('error.storageUnknown');
  }
  if (e instanceof ImageError) return t(`error.image.${e.code}` as MessageKey, { size: 15 });
  if (e instanceof ProjectError) return t(`error.import.${e.code}` as MessageKey);
  return t('error.unknown');
}