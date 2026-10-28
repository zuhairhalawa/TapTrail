import type { ViewerData } from './types';
import { sanitizeViewerData } from './validate';
import { escapeHtml, serializeForHtmlScript } from './safeJson';
import runtimeSource from '../viewer/runtime.js?raw';
import viewerCss from '../viewer/viewer.css?raw';

export const APP_VERSION = '0.1.0';

/** The runtime is an ES module in the app; inline it as a classic script by dropping the export line. */
export function inlineRuntime(): string {
  return runtimeSource.replace(/^export \{[^}]*\};?\s*$/m, '').trim();
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let binary = '';
  new Uint8Array(digest).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export interface BuildOptions {
  /** Colors for the guide: follow the reader's system setting by default. */
  theme?: 'auto' | 'light' | 'dark';
}

/**
 * Build ONE self-contained HTML document: styles, viewer logic, screenshots and text.
 *
 * Security model:
 *  - All guide data is validated first and embedded as inert JSON (never as HTML).
 *  - The viewer writes guide text only with textContent, so text can never become markup.
 *  - A Content-Security-Policy meta tag allows only the two inline blocks by SHA-256 hash,
 *    `data:` images, and nothing else: no network, no frames, no forms, no other scripts.
 */
export async function buildStandaloneHtml(input: ViewerData, options: BuildOptions = {}): Promise<string> {
  const data = sanitizeViewerData(input);
  const json = serializeForHtmlScript(data);
  const theme = options.theme ?? 'auto';
  const script =
    `\n${inlineRuntime()}\n` +
    `mountViewer(document.getElementById('taptrail-app'), JSON.parse(document.getElementById('taptrail-data').textContent), ` +
    `{ theme: '${theme}', full: true, showFooter: true });\n`;
  if (/<\/script/i.test(script) || script.includes('<!--')) {
    throw new Error('Viewer runtime contains a sequence that is unsafe to inline.');
  }
  const style = `\n${viewerCss}\nbody{margin:0}\n`;
  const [scriptHash, styleHash] = await Promise.all([sha256Base64(script), sha256Base64(style)]);
  const csp = [
    "default-src 'none'",
    "img-src data:",
    `style-src 'sha256-${styleHash}'`,
    `script-src 'sha256-${scriptHash}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const dir = data.lang === 'ar' ? 'rtl' : 'ltr';
  const noscript = escapeHtml(data.title);
  return [
    '<!doctype html>',
    `<html lang="${data.lang}" dir="${dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<meta name="generator" content="TapTrail ${APP_VERSION}">`,
    `<title>${escapeHtml(data.title || 'Guide')}</title>`,
    `<style>${style}</style>`,
    '</head>',
    '<body>',
    `<noscript><p>${noscript}: this guide needs JavaScript to be turned on in your browser.</p></noscript>`,
    '<div id="taptrail-app"></div>',
    `<script type="application/json" id="taptrail-data">${json}</script>`,
    `<script>${script}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function slugifyFilename(title: string, fallback = 'guide'): string {
  const slug = title
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}