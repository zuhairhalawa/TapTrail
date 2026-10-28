# Security policy

TapTrail is a static, client-side web app. There is no server, account system or database; all data stays in the user's browser.

## Reporting a vulnerability

Please report security problems privately using GitHub's **"Report a vulnerability"** button on the repository's *Security* tab (private vulnerability reporting). Do not open a public issue for something exploitable. Include steps to reproduce and, if relevant, a sample project file or screenshot. You can expect an acknowledgement within a few days.

## Threat model

TapTrail treats these as **untrusted input**: uploaded images, file names, project (`.json`) imports, and every piece of guide text (title, description, instructions).

Defences in place:

- **No HTML injection.** The app is React (no `dangerouslySetInnerHTML`; a lint rule forbids it). The viewer runtime is plain DOM code that only uses `textContent` / `setAttribute` (tests and lint rules forbid `innerHTML`, `eval`, `new Function`).
- **Strict import validation.** Project files are parsed with `JSON.parse`, then rebuilt field by field. Unknown keys are dropped, text is length-bounded and stripped of control/bidi-override characters, steps are capped, and images must be base64 PNG/JPEG/WebP whose first bytes match the declared type. SVG is rejected. Every imported image is then decoded and re-encoded by the browser.
- **Safe embedding.** Exported HTML stores guide data in an inert `<script type="application/json">` block with `<`, `>`, `&`, U+2028/2029 escaped.
- **Content-Security-Policy.** Exported files declare `default-src 'none'; img-src data:` and allow only their own inline script and style **by SHA-256 hash**. They cannot load or send anything over the network.
- **The app shell** is built with a CSP of `script-src 'self'` (no inline or eval scripts), `connect-src 'self'`, `object-src 'none'`.
- **No telemetry, no third-party requests, no API keys.** `.env` files are git-ignored.

## Known limits

- The CSP in exported files is delivered via a `<meta>` tag, which cannot enforce `frame-ancestors`; a hostile page could in principle embed an exported file in a frame. The file contains nothing secret.
- Local drafts in IndexedDB contain **unredacted** originals until the user burns redactions in or deletes the guide. IndexedDB is not encrypted.
- Redaction is manual. TapTrail never detects private information automatically.
- Automated browser tests run on Playwright's Chromium, Firefox and WebKit builds (Linux in CI, Windows locally). WebKit here is Playwright's engine build, not Safari itself, and no test has run on real iOS or macOS Safari.

## Supported versions

Only the latest `0.x` release receives fixes.