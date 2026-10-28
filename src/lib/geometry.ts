import type { Rect } from './types';
import { LIMITS } from './types';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Normalize any two corner points into a valid rect clamped to the unit square. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  const x1 = clamp(Math.min(ax, bx), 0, 1);
  const y1 = clamp(Math.min(ay, by), 0, 1);
  const x2 = clamp(Math.max(ax, bx), 0, 1);
  const y2 = clamp(Math.max(ay, by), 0, 1);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Keep a rect inside the unit square and above the minimum size. */
export function clampRect(r: Rect, min: number = LIMITS.minRectSize): Rect {
  const w = clamp(r.w, min, 1);
  const h = clamp(r.h, min, 1);
  return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h), w, h };
}

export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Resize by dragging one handle by (dx, dy) in normalized units. */
export function resizeRect(r: Rect, handle: Handle, dx: number, dy: number, min: number = LIMITS.minRectSize): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - min);
  if (handle.includes('e')) right = clamp(right + dx, left + min, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Convert a client-space pointer position to normalized image coordinates. */
export function pointToNormalized(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp((clientX - box.left) / box.width, 0, 1),
    y: clamp((clientY - box.top) / box.height, 0, 1),
  };
}

/** Normalized rect -> CSS percentage box (resolution independent). */
export function rectToPercent(r: Rect): { left: string; top: string; width: string; height: string } {
  const f = (n: number) => `${Math.round(n * 100000) / 1000}%`;
  return { left: f(r.x), top: f(r.y), width: f(r.w), height: f(r.h) };
}

/** Normalized rect -> pixel rect for an image of the given size. */
export function rectToPixels(r: Rect, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const x = Math.floor(r.x * width);
  const y = Math.floor(r.y * height);
  return {
    x,
    y,
    w: Math.min(width - x, Math.ceil((r.x + r.w) * width - 1e-9) - x),
    h: Math.min(height - y, Math.ceil((r.y + r.h) * height - 1e-9) - y),
  };
}

export function pointInRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Fit (w,h) so the longest side is at most `max`, preserving aspect ratio. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
