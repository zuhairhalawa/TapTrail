import { describe, expect, it } from 'vitest';
import {
  checkImageDataUrl, parseProjectText, ProjectError, sanitizeViewerData, stringifyProject, validateGuideData, type ProjectGuideData,
} from './validate';
import { LIMITS } from './types';
import { fakeImageDataUrl, sampleViewerData } from '../test/fixtures';

const guide = (): ProjectGuideData => ({
  title: 'Round trip <b>',
  description: 'desc',
  lang: 'ar',
  steps: [
    { instruction: 'اضغط هنا', image: fakeImageDataUrl('webp'), width: 360, height: 640, hotspot: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
    { instruction: 'No hotspot', image: fakeImageDataUrl('jpeg'), width: 10, height: 10, hotspot: null },
  ],
});

const project = (mutate: (p: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = JSON.parse(stringifyProject(guide()));
  mutate(p);
  return JSON.stringify(p);
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ProjectError ? e.code : `other:${String(e)}`;
  }
  return 'no-error';
};

describe('project JSON round trip', () => {
  it('exports and imports without loss', () => {
    const parsed = parseProjectText(stringifyProject(guide()));
    expect(parsed).toEqual(guide());
  });
  it('keeps all three supported image types', () => {
    for (const k of ['png', 'jpeg', 'webp'] as const) expect(() => checkImageDataUrl(fakeImageDataUrl(k), 'x')).not.toThrow();
  });
});

describe('invalid or malicious imports', () => {
  it('rejects text that is not JSON', () => expect(code(() => parseProjectText('<script>alert(1)</script>'))).toBe('not_json'));
  it('rejects JSON that is not a TapTrail project', () => {
    expect(code(() => parseProjectText('{"a":1}'))).toBe('wrong_format');
    expect(code(() => parseProjectText('[]'))).toBe('wrong_format');
    expect(code(() => parseProjectText('null'))).toBe('wrong_format');
  });
  it('rejects unknown versions', () => expect(code(() => parseProjectText(project((p) => (p.version = 99))))).toBe('unsupported_version'));
  it('rejects oversized files', () => expect(code(() => parseProjectText('x'.repeat(LIMITS.maxImportFileBytes + 1)))).toBe('too_large'));
  it('rejects too many steps', () => {
    const many = Array.from({ length: LIMITS.maxSteps + 1 }, () => guide().steps[0]);
    expect(code(() => validateGuideData({ title: 't', steps: many }))).toBe('too_many_steps');
  });
  it('rejects non-image data URLs (svg, html, javascript)', () => {
    for (const bad of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PGgxPmhpPC9oMT4=', 'javascript:alert(1)', 'https://evil.example/x.png', 42, null]) {
      expect(code(() => checkImageDataUrl(bad, 'img'))).toBe('bad_image');
    }
  });
  it('rejects data whose bytes do not match the declared type', () => {
    const png = fakeImageDataUrl('png');
    expect(code(() => checkImageDataUrl(png.replace('image/png', 'image/jpeg'), 'img'))).toBe('bad_image');
  });
  it('rejects invalid base64 and oversize images', () => {
    expect(code(() => checkImageDataUrl('data:image/png;base64,' + '!'.repeat(64), 'img'))).toBe('bad_image');
    expect(code(() => checkImageDataUrl(fakeImageDataUrl(), 'img', 10))).toBe('image_too_large');
  });
  it('rejects invalid hotspots', () => {
    for (const hotspot of [{ x: -1, y: 0, w: 0.1, h: 0.1 }, { x: 0, y: 0, w: 2, h: 0.1 }, { x: 0.9, y: 0, w: 0.5, h: 0.1 }, { x: 'a', y: 0, w: 1, h: 1 }, { x: NaN, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 0, h: 0.2 }, 'x']) {
      expect(code(() => parseProjectText(project((p) => (p.guide.steps[0].hotspot = hotspot))))).toBe('invalid');
    }
  });
  it('rejects invalid sizes, languages and over-long text', () => {
    expect(code(() => parseProjectText(project((p) => (p.guide.steps[0].width = -5))))).toBe('invalid');
    expect(code(() => parseProjectText(project((p) => (p.guide.steps[0].width = 1.5))))).toBe('invalid');
    expect(code(() => parseProjectText(project((p) => (p.guide.lang = 'fr'))))).toBe('invalid');
    expect(code(() => parseProjectText(project((p) => (p.guide.title = 'x'.repeat(LIMITS.maxTitle + 1)))))).toBe('invalid');
    expect(code(() => parseProjectText(project((p) => (p.guide.steps[0].instruction = { evil: 1 }))))).toBe('invalid');
    expect(code(() => parseProjectText(project((p) => (p.guide.steps = 'nope'))))).toBe('invalid');
  });
  it('does not copy unknown or prototype-polluting keys', () => {
    const text = project((p) => { p.guide.extra = 'x'; });
    const withProto = text.replace('"guide":', '"__proto__":{"polluted":true},"guide":');
    const parsed = parseProjectText(withProto);
    expect(Object.keys(parsed).sort()).toEqual(['description', 'lang', 'steps', 'title']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('strips control and bidi-override characters from text', () => {
    const cleaned = validateGuideData({ ...guide(), title: 'a\u0000b‮c\u0007' });
    expect(cleaned.title).toBe('abc');
  });
  it('keeps script-like text as plain data (it is escaped later, never executed)', () => {
    const g = validateGuideData({ ...guide(), title: '<img src=x onerror=alert(1)>' });
    expect(g.title).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('viewer data sanitizing for export', () => {
  it('accepts well-formed data', () => expect(sanitizeViewerData(sampleViewerData()).steps).toHaveLength(3));
  it('rejects blob: or external image sources', () => {
    const d = sampleViewerData();
    d.steps[0]!.image = 'blob:http://localhost/abc';
    expect(code(() => sanitizeViewerData(d))).toBe('bad_image');
  });
  it('rejects missing labels', () => {
    const d = sampleViewerData();
    (d.labels as unknown as Record<string, unknown>).next = 5;
    expect(code(() => sanitizeViewerData(d))).toBe('invalid');
  });
});