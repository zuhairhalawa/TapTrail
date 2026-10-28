import { describe, expect, it } from 'vitest';
import { en } from './en';
import { ar } from './ar';
import { translate, viewerLabels } from './I18n';

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('translations', () => {
  it('Arabic covers every English key, with no extras and no empty strings', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(ar)) expect(v.trim(), k).not.toBe('');
  });
  it('keeps placeholders identical in both languages', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(ar[k]), k).toBe(placeholders(en[k]));
  });
  it('interpolates variables', () => {
    expect(translate('en', 'viewer.step', { n: 2, total: 5 })).toBe('Step 2 of 5');
    expect(translate('ar', 'viewer.step', { n: 2, total: 5 })).toContain('2');
  });
  it('provides all viewer labels for both languages', () => {
    for (const l of ['en', 'ar'] as const) for (const v of Object.values(viewerLabels(l))) expect(v.length).toBeGreaterThan(0);
  });
});