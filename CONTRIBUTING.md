# Contributing to TapTrail

Thanks for helping! TapTrail aims to stay small, private and easy for non-technical people to use.

## Ground rules

- **No backend, accounts, analytics or paid APIs.** Everything runs in the browser.
- **User content is untrusted.** Never inject it as HTML; never relax validation or the exported file's CSP to make something easier.
- Keep the exported guide **self-contained and offline**: no external scripts, styles, fonts or images.
- Use plain language in the UI. Every new string needs **both English and Arabic** (`src/i18n/en.ts`, `src/i18n/ar.ts`; the compiler enforces completeness).
- Prefer logical CSS (`ms-*`, `ps-*`, `text-start`) so right-to-left layouts keep working.

## Setup

```bash
npm install
npx playwright install chromium firefox webkit   # only needed for browser tests
npm run dev                       # http://localhost:5173/TapTrail/
```

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm test              # unit + component tests (Vitest)
npm run build
npm run test:e2e      # builds, serves the production bundle, runs Playwright on Chromium, Firefox, WebKit and a phone profile
```

Add tests for behaviour you change. Security-relevant changes (import validation, export, redaction) need tests that try to break them. Do not weaken or delete a test to make it pass.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/viewer/` | The viewer runtime (plain JS) and CSS, used by the app **and inlined into exported files** |
| `src/lib/` | Geometry, validation, image processing, storage (IndexedDB), export |
| `src/pages/`, `src/components/` | React UI |
| `src/i18n/` | English and Arabic strings |
| `e2e/` | Playwright tests (Chromium, Firefox, WebKit, mobile) and the README screenshot script |

## Commit style

Short imperative subject line, e.g. `Fix hotspot resize near image edge`.