// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import { buildStandaloneHtml, inlineRuntime, slugifyFilename } from './exportHtml';
import { serializeForHtmlScript, escapeHtml } from './safeJson';
import { ProjectError } from './validate';
import { fakeImageDataUrl, sampleViewerData } from '../test/fixtures';

const EVIL = '</script><script>window.__pwned=1</script><!-- <img src=x onerror=alert(1)>     &amp;';

function load(html: string) {
  return new JSDOM(html, { runScripts: 'dangerously', url: 'file:///guide.html' });
}

describe('safe serialization', () => {
  it('escapes every sequence that could leave a script block, and still round-trips', () => {
    const out = serializeForHtmlScript({ t: EVIL });
    expect(out).not.toMatch(/<|>|&/);
    expect(out).not.toContain(' ');
    expect(JSON.parse(out)).toEqual({ t: EVIL });
  });
  it('escapes HTML text', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  });
});

describe('standalone HTML export', () => {
  it('is one document with exactly one executable script and one style block', async () => {
    const html = await buildStandaloneHtml(sampleViewerData({ title: EVIL, description: EVIL }));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    expect(scripts).toHaveLength(2); // inert JSON data block + the viewer
    expect(scripts.filter((s) => /application\/json/.test(s))).toHaveLength(1);
    expect(html.match(/<style\b/gi)).toHaveLength(1);
    expect(html.match(/<\/script>/gi)).toHaveLength(2);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('</script><script>window');
  });

  it('escapes the title in <title> and keeps the text safe when the page runs', async () => {
    const html = await buildStandaloneHtml(sampleViewerData({ title: EVIL, description: EVIL }));
    const dom = load(html);
    const doc = dom.window.document;
    expect(doc.title).toBe(EVIL);
    expect(doc.querySelector('h1')!.textContent).toBe(EVIL);
    expect((dom.window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(doc.querySelectorAll('script')).toHaveLength(2);
    expect(doc.querySelectorAll('img[src="x"]')).toHaveLength(0);
  });

  it('contains a working viewer that can be clicked through', async () => {
    const dom = load(await buildStandaloneHtml(sampleViewerData()));
    const doc = dom.window.document;
    expect(doc.querySelector('.tt-progress-text')!.textContent).toBe('Step 1 of 3');
    (doc.querySelector('.tt-hotspot') as HTMLElement).click();
    expect(doc.querySelector('.tt-progress-text')!.textContent).toBe('Step 2 of 3');
  });

  it('has a CSP that allows only its own two inline blocks by hash, plus data: images', async () => {
    const html = await buildStandaloneHtml(sampleViewerData());
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('img-src data:');
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
    const scriptBody = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const styleBody = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('base64');
    expect(csp).toContain(`script-src 'sha256-${hash(scriptBody)}'`);
    expect(csp).toContain(`style-src 'sha256-${hash(styleBody)}'`);
    expect(csp).not.toContain('connect-src'); // falls back to default-src 'none'
  });

  it('makes no references to external resources or the editor', async () => {
    const html = await buildStandaloneHtml(sampleViewerData());
    const withoutData = html.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, 'DATA');
    expect(withoutData).not.toMatch(/https?:\/\//i);
    expect(withoutData).not.toMatch(/<link\b|<iframe|<object|<embed|<form|src="(?!DATA)|@import|url\(|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|import\(/i);
    expect(withoutData).not.toMatch(/taptrail\.github|zuhairhalawa|localhost|\/assets\//i);
  });

  it('refuses to embed anything that fails validation', async () => {
    const bad = sampleViewerData();
    bad.steps[0]!.image = 'https://evil.example/x.png';
    await expect(buildStandaloneHtml(bad)).rejects.toBeInstanceOf(ProjectError);
    const svg = sampleViewerData();
    svg.steps[0]!.image = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    await expect(buildStandaloneHtml(svg)).rejects.toBeInstanceOf(ProjectError);
  });

  it('sets language and direction, including RTL for Arabic', async () => {
    const html = await buildStandaloneHtml(sampleViewerData({ lang: 'ar' }));
    expect(html).toContain('<html lang="ar" dir="rtl">');
  });

  it('embeds each screenshot exactly as provided', async () => {
    const d = sampleViewerData();
    d.steps[1]!.image = fakeImageDataUrl('jpeg', 7);
    const dom = load(await buildStandaloneHtml(d));
    const data = JSON.parse(dom.window.document.getElementById('taptrail-data')!.textContent!);
    expect(data.steps[1].image).toBe(d.steps[1]!.image);
  });

  it('inlines a runtime that is safe to put inside a script tag', () => {
    const rt = inlineRuntime();
    expect(rt).not.toMatch(/<\/script|<!--/i);
    expect(rt).not.toMatch(/^export /m);
    expect(rt).toContain('function mountViewer');
  });

  it('builds safe file names', () => {
    expect(slugifyFilename('How to: turn on <security>!')).toBe('How-to-turn-on-security');
    expect(slugifyFilename('../../etc/passwd')).toBe('etc-passwd');
    expect(slugifyFilename('كيف تفعّل الأمان')).toContain('كيف');
    expect(slugifyFilename('???')).toBe('guide');
  });
});