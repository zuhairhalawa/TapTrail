/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Adds a strict Content-Security-Policy to the production app shell only.
 * (The dev server needs inline scripts for hot reload, so it is skipped there.)
 * Exported guides carry their own, stricter policy (see src/lib/exportHtml.ts).
 */
function appCsp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'taptrail-app-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--app-csp-->',
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

// GitHub Pages serves the project at https://zuhairhalawa.github.io/TapTrail/
export default defineConfig({
  base: '/TapTrail/',
  plugins: [react(), tailwindcss(), appCsp()],
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
