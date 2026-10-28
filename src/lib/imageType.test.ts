import { describe, expect, it } from 'vitest';
import { formatBytes, sniffImageType } from './imageType';
import { paintRedactions, processUpload, ImageError } from './image';
import { LIMITS } from './types';

describe('image type detection', () => {
  it('recognizes PNG, JPEG and WebP by their bytes', () => {
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1]))).toBe('image/jpeg');
    expect(sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
  });
  it('rejects everything else, whatever the file name says', () => {
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('GIF89a......'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });
  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('upload validation', () => {
  it('rejects files over the size limit before reading them', async () => {
    const big = new Blob([new Uint8Array(LIMITS.maxUploadBytes + 1)], { type: 'image/png' });
    await expect(processUpload(big)).rejects.toMatchObject({ code: 'too_big' });
  });
  it('rejects non-images, including text renamed as .png', async () => {
    const fake = new File(['not really a png'], 'cat.png', { type: 'image/png' });
    await expect(processUpload(fake)).rejects.toBeInstanceOf(ImageError);
    await expect(processUpload(fake)).rejects.toMatchObject({ code: 'unsupported' });
  });
  it('rejects SVG uploads', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'a.svg', { type: 'image/svg+xml' });
    await expect(processUpload(svg)).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('redaction painting', () => {
  it('paints every rectangle opaque black at pixel precision', () => {
    const calls: number[][] = [];
    const ctx = { fillRect: (...a: number[]) => calls.push(a), fillStyle: '', globalAlpha: 0.2 };
    paintRedactions(ctx, 200, 100, [{ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, { x: 0.9, y: 0.9, w: 0.1, h: 0.1 }]);
    expect(ctx.fillStyle).toBe('#000000');
    expect(ctx.globalAlpha).toBe(1);
    expect(calls).toEqual([[20, 20, 100, 25], [180, 90, 20, 10]]);
  });
});