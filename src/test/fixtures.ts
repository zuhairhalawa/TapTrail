import type { ViewerData, ViewerLabels } from '../lib/types';
import { viewerLabels } from '../i18n/I18n';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

/** A data URL that has the right magic bytes for its type (not a decodable picture; fine for structure tests). */
export function fakeImageDataUrl(kind: 'png' | 'jpeg' | 'webp' = 'png', filler = 0): string {
  const bytes = new Uint8Array(48).fill(filler);
  if (kind === 'png') bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (kind === 'jpeg') bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  if (kind === 'webp') bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const mime = kind === 'jpeg' ? 'image/jpeg' : `image/${kind}`;
  return `data:${mime};base64,${toBase64(bytes)}`;
}

export const labels: ViewerLabels = viewerLabels('en');

export function sampleViewerData(overrides: Partial<ViewerData> = {}): ViewerData {
  return {
    title: 'Sample guide',
    description: 'Describes things',
    lang: 'en',
    labels,
    steps: [
      { instruction: 'Tap the red box', image: fakeImageDataUrl(), width: 400, height: 800, hotspot: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      { instruction: 'Read this screen', image: fakeImageDataUrl(), width: 400, height: 800, hotspot: null },
      { instruction: 'Tap the blue box', image: fakeImageDataUrl(), width: 400, height: 800, hotspot: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
    ],
    ...overrides,
  };
}