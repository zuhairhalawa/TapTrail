import { beforeEach, describe, expect, it } from 'vitest';
import { mountViewer } from './runtime.js';
import { sampleViewerData } from '../test/fixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let root: HTMLElement;
beforeEach(() => {
  document.body.textContent = '';
  root = document.createElement('div');
  document.body.appendChild(root);
});

const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const key = (target: Element, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const progressText = () => q('.tt-progress-text').textContent;

describe('interactive viewer', () => {
  it('shows the first step with instruction, screenshot and highlighted hotspot', () => {
    mountViewer(root, sampleViewerData());
    expect(q('h1').textContent).toBe('Sample guide');
    expect(q('.tt-instruction').textContent).toBe('Tap the red box');
    expect(progressText()).toBe('Step 1 of 3');
    const hs = q('.tt-hotspot');
    expect(hs.hidden).toBe(false);
    expect(hs.style.left).toBe('10%');
    expect(hs.style.top).toBe('20%');
    expect(hs.style.width).toBe('30%');
    expect(hs.style.height).toBe('10%');
    expect(hs.getAttribute('aria-label')).toBe('Click here: Tap the red box');
    expect(q('img').getAttribute('alt')).toBe('Screenshot for step 1');
  });

  it('advances when the expected hotspot is clicked, and moves focus to the new instruction', () => {
    mountViewer(root, sampleViewerData());
    q('.tt-hotspot').click();
    expect(progressText()).toBe('Step 2 of 3');
    expect(document.activeElement).toBe(q('.tt-instruction'));
  });

  it('does not advance on clicks elsewhere on the screenshot and gives gentle feedback', () => {
    mountViewer(root, sampleViewerData());
    q('.tt-img').click();
    expect(progressText()).toBe('Step 1 of 3');
    expect(q('.tt-feedback').textContent).toContain('Not quite');
  });

  it('works without a hotspot: instructions and Next remain available', () => {
    mountViewer(root, sampleViewerData());
    q('.tt-nav .tt-btn-primary').click();
    expect(q('.tt-hotspot').hidden).toBe(true);
    expect(q('.tt-instruction').textContent).toBe('Read this screen');
    expect(q('.tt-hint').textContent).toContain('press Next');
  });

  it('supports Back and Next buttons and labels the final step Finish', () => {
    mountViewer(root, sampleViewerData());
    const next = q('.tt-nav .tt-btn-primary');
    const back = q('.tt-nav .tt-btn-quiet');
    expect(back.hidden).toBe(true);
    next.click();
    next.click();
    expect(next.textContent).toBe('Finish');
    back.click();
    expect(progressText()).toBe('Step 2 of 3');
  });

  it('shows a completion state and can restart', () => {
    mountViewer(root, sampleViewerData());
    const next = q('.tt-nav .tt-btn-primary');
    next.click(); next.click(); next.click();
    expect(q('.tt-done').hidden).toBe(false);
    expect(q('.tt-done-title').textContent).toBe('You did it!');
    expect(q('.tt-card:not(.tt-done)').hidden).toBe(true);
    const restart = Array.from(root.querySelectorAll<HTMLButtonElement>('.tt-btn')).find((b) => b.textContent === 'Start again')!;
    expect(restart.hidden).toBe(false);
    restart.click();
    expect(progressText()).toBe('Step 1 of 3');
    expect(q('.tt-done').hidden).toBe(true);
  });

  it('reports progress to assistive technology', () => {
    mountViewer(root, sampleViewerData());
    const bar = q('.tt-bar');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuemax')).toBe('3');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    q('.tt-nav .tt-btn-primary').click();
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuetext')).toBe('Step 2 of 3');
    expect(q('[role=status][aria-live=polite]').textContent).toContain('Read this screen');
    expect(root.querySelectorAll('.tt-seg-done')).toHaveLength(1);
  });

  it('is fully keyboard operable: arrow keys navigate, hotspot is a real focusable button', () => {
    mountViewer(root, sampleViewerData());
    const hs = q<HTMLButtonElement>('.tt-hotspot');
    expect(hs.tagName).toBe('BUTTON');
    expect(hs.tabIndex).toBe(0);
    key(hs, 'ArrowRight');
    expect(progressText()).toBe('Step 2 of 3');
    key(hs, 'ArrowLeft');
    expect(progressText()).toBe('Step 1 of 3');
    key(hs, 'ArrowLeft'); // cannot go before the first step
    expect(progressText()).toBe('Step 1 of 3');
  });

  it('flips arrow keys and direction for Arabic (RTL) guides', () => {
    mountViewer(root, sampleViewerData({ lang: 'ar' }));
    expect(q('.tt-viewer').getAttribute('dir')).toBe('rtl');
    key(q('.tt-hotspot'), 'ArrowLeft');
    expect(progressText()).toBe('Step 2 of 3');
    key(q('.tt-hotspot'), 'ArrowRight');
    expect(progressText()).toBe('Step 1 of 3');
  });

  it('ignores arrow keys combined with modifiers (browser shortcuts)', () => {
    mountViewer(root, sampleViewerData());
    q('.tt-hotspot').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    expect(progressText()).toBe('Step 1 of 3');
  });

  it('handles a guide with no steps without crashing', () => {
    mountViewer(root, sampleViewerData({ steps: [] }));
    expect(q('.tt-progress').hidden).toBe(true);
  });

  it('builds a print version listing every step with its hotspot', () => {
    mountViewer(root, sampleViewerData());
    const items = root.querySelectorAll('.tt-print-step');
    expect(items).toHaveLength(3);
    expect(items[0]!.querySelector('.tt-print-hotspot')).not.toBeNull();
    expect(items[1]!.querySelector('.tt-print-hotspot')).toBeNull();
  });
});

describe('viewer treats guide text as text, never as HTML', () => {
  const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
  it('renders markup-looking titles, descriptions and instructions inertly', () => {
    const d = sampleViewerData({ title: evil, description: evil });
    d.steps[0]!.instruction = evil;
    mountViewer(root, d);
    expect(q('h1').textContent).toBe(evil);
    expect(q('.tt-instruction').textContent).toBe(evil);
    expect(root.querySelectorAll('script')).toHaveLength(0);
    expect(root.querySelectorAll('img[src="x"]')).toHaveLength(0);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
  it('keeps attribute-breaking text inside the aria-label', () => {
    const d = sampleViewerData();
    d.steps[0]!.instruction = '"><button id=injected>';
    mountViewer(root, d);
    expect(root.querySelector('#injected')).toBeNull();
    expect(q('.tt-hotspot').getAttribute('aria-label')).toContain('"><button id=injected>');
  });
  it('the runtime source never uses HTML-parsing APIs', () => {
    const src = readFileSync(resolve(__dirname, 'runtime.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });
});

describe('motion and contrast preferences', () => {
  const css = readFileSync(resolve(__dirname, 'viewer.css'), 'utf8');
  it('only animates when the user has not asked for reduced motion', () => {
    const animations = css.split('\n').filter((l) => /animation:/.test(l));
    expect(animations.length).toBeGreaterThan(0);
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    for (const l of animations) expect(block).toContain(l.trim());
    expect(css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'))).not.toMatch(/animation:/);
  });
  it('has a visible keyboard focus style', () => {
    expect(css).toMatch(/\.tt-hotspot:focus-visible/);
    expect(css).toMatch(/\.tt-btn:focus-visible/);
  });
});