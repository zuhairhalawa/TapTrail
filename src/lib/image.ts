import type { Rect } from './types';
import { LIMITS } from './types';
import { fitWithin, rectToPixels } from './geometry';
import { sniffImageType } from './imageType';

export type ImageErrorCode = 'too_big' | 'unsupported' | 'corrupt' | 'too_many_pixels' | 'encode_failed';

export class ImageError extends Error {
  readonly code: ImageErrorCode;
  constructor(code: ImageErrorCode) {
    super(code);
    this.name = 'ImageError';
    this.code = code;
  }
}

export interface ProcessedImage {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
}

/** Colour used to cover private areas. Fully opaque so nothing underneath can be recovered. */
export const REDACTION_COLOR = '#000000';

/** Paint opaque rectangles into a 2D context. Exported for testing. */
export function paintRedactions(
  ctx: Pick<CanvasRenderingContext2D, 'fillRect' | 'fillStyle' | 'globalAlpha'>,
  width: number,
  height: number,
  redactions: Rect[],
): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = REDACTION_COLOR;
  for (const r of redactions) {
    const p = rectToPixels(r, width, height);
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Encode a canvas as WebP when the browser can, otherwise PNG. Both drop all source metadata. */
async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await canvasToBlob(canvas, 'image/webp', 0.92);
  if (webp && webp.type === 'image/webp') return webp;
  const png = await canvasToBlob(canvas, 'image/png');
  if (!png) throw new ImageError('encode_failed');
  return png;
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new ImageError('corrupt');
  }
}

/**
 * Validate and re-encode an uploaded screenshot.
 * Drawing into a canvas and re-encoding discards EXIF (location, camera, dates), ICC profiles
 * and any text/comment chunks, so original metadata is never carried into storage or export.
 */
export async function processUpload(file: Blob): Promise<ProcessedImage> {
  if (file.size > LIMITS.maxUploadBytes) throw new ImageError('too_big');
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniffImageType(head)) throw new ImageError('unsupported');
  const bitmap = await decode(file);
  try {
    if (bitmap.width * bitmap.height > LIMITS.maxImagePixels) throw new ImageError('too_many_pixels');
    const { width, height } = fitWithin(bitmap.width, bitmap.height, LIMITS.maxImageSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageError('encode_failed');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const out = await encodeCanvas(canvas);
    return { blob: out, mime: out.type, width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * Produce the picture that is previewed/exported: the stored image with every redaction
 * rectangle painted into the real pixels, then freshly encoded.
 */
export async function bakeRedactions(blob: Blob, redactions: Rect[]): Promise<ProcessedImage> {
  const bitmap = await decode(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageError('encode_failed');
    ctx.drawImage(bitmap, 0, 0);
    paintRedactions(ctx, canvas.width, canvas.height, redactions);
    const out = await encodeCanvas(canvas);
    return { blob: out, mime: out.type, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const comma = dataUrl.indexOf(',');
  const mime = /^data:([^;]+);base64/.exec(dataUrl.slice(0, comma))?.[1] ?? 'application/octet-stream';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}