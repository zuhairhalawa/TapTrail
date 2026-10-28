import { describe, expect, it } from 'vitest';
import {
  clampRect, fitWithin, moveRect, pointInRect, pointToNormalized, rectFromPoints, rectToPercent, rectToPixels, resizeRect,
} from './geometry';

describe('hotspot coordinate scaling', () => {
  const box = { left: 100, top: 50, width: 400, height: 800 };

  it('converts pointer positions to normalized coordinates', () => {
    expect(pointToNormalized(300, 450, box)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointToNormalized(100, 50, box)).toEqual({ x: 0, y: 0 });
  });

  it('clamps pointers outside the image', () => {
    expect(pointToNormalized(-50, 9999, box)).toEqual({ x: 0, y: 1 });
  });

  it('is resolution independent: the same normalized rect maps to every display size', () => {
    const r = { x: 0.25, y: 0.1, w: 0.5, h: 0.2 };
    expect(rectToPixels(r, 400, 800)).toEqual({ x: 100, y: 80, w: 200, h: 160 });
    expect(rectToPixels(r, 200, 400)).toEqual({ x: 50, y: 40, w: 100, h: 80 });
    expect(rectToPercent(r)).toEqual({ left: '25%', top: '10%', width: '50%', height: '20%' });
  });

  it('a pointer click inside a rect hits regardless of display scale', () => {
    const r = { x: 0.25, y: 0.1, w: 0.5, h: 0.2 };
    for (const scale of [0.5, 1, 2.5]) {
      const b = { left: 0, top: 0, width: 400 * scale, height: 800 * scale };
      expect(pointInRect(pointToNormalized(200 * scale, 120 * scale, b), r)).toBe(true);
      expect(pointInRect(pointToNormalized(10 * scale, 10 * scale, b), r)).toBe(false);
    }
  });

  it('handles a zero-sized box without NaN', () => {
    expect(pointToNormalized(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('rect helpers', () => {
  it('builds a rect from any two corners', () => {
    expect(rectFromPoints(0.6, 0.7, 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, w: expect.closeTo(0.4), h: expect.closeTo(0.6) });
  });
  it('keeps rects inside the image and above the minimum', () => {
    const r = clampRect({ x: 0.95, y: -1, w: 0.5, h: 0 });
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y).toBe(0);
    expect(r.h).toBeGreaterThan(0);
  });
  it('moves without leaving the image', () => {
    expect(moveRect({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 }, 0.5, 0.5)).toEqual({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 });
  });
  it('resizes from each handle without inverting', () => {
    const r = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    expect(resizeRect(r, 'se', 0.1, 0.1)).toEqual({ x: 0.4, y: 0.4, w: expect.closeTo(0.3), h: expect.closeTo(0.3) });
    const shrunk = resizeRect(r, 'e', -5, 0);
    expect(shrunk.w).toBeGreaterThan(0);
    expect(resizeRect(r, 'nw', -5, -5)).toMatchObject({ x: 0, y: 0 });
  });
  it('fits large images within the maximum side', () => {
    expect(fitWithin(4000, 2000, 2000)).toEqual({ width: 2000, height: 1000 });
    expect(fitWithin(100, 50, 2000)).toEqual({ width: 100, height: 50 });
  });
});