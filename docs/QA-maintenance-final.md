# Final maintenance QA: navigation save policy, stale Preview, release gate

Owner: Zuhair Halawa (GitHub zuhairhalawa). Fictional data only.

* Starting commit: `b942468ff5ddf76ace2a42dea8592ea0d89bceb0` on `fix/studio-redaction-import-atomicity-preview-race`
* Original release: `0331c8f35a6c78a70787dfeedd00743a2254fc0b` (`v0.1.0`)
* Work branch: `fix/navigation-release-gate-20261029-133056` (local only; nothing pushed, merged, tagged or deployed)
* Raw logs: kept outside the repository (private run records); summaries below.

## Starting point

The repair branch (4 commits over the release) already fixed: Studio thumbnails paint pending covers without
touching drafts and never show uncovered pixels on failure; project import stores guide and images atomically
(`add` + `tx.done`); Preview waits for an in-flight save. All three are preserved and their tests are untouched
(only a wait was added to three import tests, see "Test infrastructure").

Defects that remained, reproduced before changing code:

1. Only the two Preview links used the save gate. "All guides", the header links and browser Back/Forward
   unmounted an editor whose save had failed (the unmount cleanup then tried one more write, silently).
2. `Editor.openPreview` navigated from `flush().then(...)` with no check that the request was still current.

## Baseline (unmodified repair branch, before any change)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass |
| Unit | `npm test` | 11 files, **119 passed** |
| Build | `npm run build` | pass |
| Audit | `npm audit --audit-level=low` | 0 vulnerabilities |
| Browser | `npx playwright test -c e2e/.tmp/pw.local.config.ts` (port 4391) | **84 passed, 2 failed (both WebKit)**, 86 tests |

The author's "86 browser tests passing" was **not reproduced on WebKit** in this environment. The two WebKit failures:

* `robustness.spec.ts:360` (import, record save fails): the test snapshots the DB as soon as the "Saved" label shows,
  but that label is already shown *before the first autosave runs* (initial state is "saved", the 500 ms autosave
  then writes the step). On WebKit the autosave landed between snapshot and comparison
  (`referencedImageIds: []` vs `[id]`). This is a test race, not an app defect. Confirmed in the final run, where
  three import tests hit it before the wait was added.
* `autosave-preview.spec.ts:61` (a click on the Preview link timed out after a retry, 60 s). Not reproduced in the
  isolated rerun and not seen again in any later run. Treated as an unexplained WebKit flake of the baseline;
  with the changes below the same test passed on all engines in the final run.

A separate cold-start WebKit flake (`createGuide`: the name field found empty after `fill`) also occurred on the
*unmodified* code in an isolated rerun of `robustness.spec.ts:360` on a clean checkout of the starting commit
(git worktree outside the repository, removed afterwards). The helper now confirms the value before submitting.
A baseline rerun of the whole WebKit project was attempted but the runner dropped the `--project` filter; it was
stopped and discarded (it did not produce usable results).

Local server: the original `playwright.config.ts` uses port 4173, which was in use by another process (not
touched). A temporary, git-ignored override `e2e/.tmp/pw.local.config.ts` (deleted at the end) spreads the original
config (same projects, assertions, retries, reporter) and only sets `baseURL`, `webServer.command`, `cwd`,
`url` to **127.0.0.1:4391**, absolute `testDir`/`outputDir`, `reuseExistingServer: false`. The foreground Playwright
webServer lifecycle ran `npm run build && npx vite preview --host 127.0.0.1 --port 4391 --strictPort`. Local
`retries` stayed 0 (CI uses 1). No zero-test run was accepted: every run printed its test count.

## What changed (relative to `b942468`)

| File | Change |
|---|---|
| `src/router.ts` | The router is now one small store (`useSyncExternalStore`). A page can register one **navigation guard**; the router asks it before changing the displayed route, for link clicks (capture listener), Ctrl/Cmd/Shift/Alt/middle clicks (`click` and `auxclick`) and history changes. History: each entry is stamped with an index in `history.state`, so a held Back/Forward is undone with `history.go(-delta)` and completed with `history.go(delta)`; no loop. `proceed()` skips the guard for exactly the hash it heads to |
| `src/pages/Editor.tsx` | Registers the guard. `openPreview` is gone: both Preview links are ordinary links now. Unsaved/saving work is saved first; only the **newest** request may navigate (sequence number; also bumped on cancel and on unmount). On failure: stay, close dialogs, focus **Try saving again**, show "You are still on this page…", keep Retry and backup, offer **Keep editing** and **Leave without saving** (discards only unsaved edits). The discard flag stops the unmount cleanup and autosave from writing it; it is cleared if the page did not actually change or on the next edit. `beforeunload` ignores a deliberate discard |
| `src/i18n/en.ts`, `ar.ts` | 4 new strings in both languages |
| `src/router.test.ts` | 7 new unit tests |
| `e2e/navigation-guard.spec.ts` | 20 browser tests, run on desktop, firefox, webkit (60 runs) |
| `e2e/mobile.spec.ts` | 1 new mobile test |
| `e2e/helpers.ts` | additive: release-based DB hold (`__holdDbUntilReleased`/`__releaseDb`, no timer), nav/click log, `storedGuides`, `expectStored`, `openEditorWithStep`, `qaShot`; `createGuide` verifies the field value |
| `e2e/robustness.spec.ts` | one added wait (stored guide references the picture) before the DB snapshot in `withExistingGuide`; no assertion changed |
| `.github/workflows/ci.yml`, `pages.yml` (deleted) | single gated workflow, see `docs/release-workflow-risk.md` |
| `README.md`, `docs/release-workflow-risk.md` | updated; this report added |

Unchanged: image processing/quality, thumbnails, import code, storage, exports, privacy behaviour, dependencies,
`package.json`/lockfile, version.

Delta against the original release `0331c8f`: everything in the repair branch's 13-file diff (thumbnail, atomic import,
Preview save, tests, the risk note) **plus** the table above. `git diff --stat` for both bases is in the final report.

## Policy that is now implemented

* Clean editor: every exit works immediately, no dialog, no banner.
* Anything pending or saving: save first (joining an in-flight save), then go.
* Save failed: stay. Nothing is claimed saved (status stays "Not saved"). Retry, backup download,
  Keep editing, Leave without saving are available and reachable by keyboard (focus lands on Retry; Tab order
  Retry, Backup, Keep editing, Leave).
* **Newest request wins.** Preview then Privacy: Privacy. Privacy then Preview: Preview. Three requests: one navigation,
  one history entry. A completion that belongs to a cancelled/superseded request or to an editor that was left
  does nothing.
* Retry success clears the held request; it does not navigate by itself (the user clicks again).
* Discard cannot cancel a write that already started: the button does nothing while a save is running.
* Modified clicks: Ctrl/Cmd-click (`click` event) and middle-click (`auxclick` event, a different path) on a link
  to **this guide's Preview/editor** with pending edits are prevented and only trigger the save, so another tab never
  opens on stale stored data; nothing is replayed after the asynchronous wait (no popup). With saved edits the
  gesture is not prevented (ordinary browser behaviour). Links to Studio/Privacy/Home open normally in a new tab.
  Context-menu "Open in new tab" cannot be intercepted; a new tab can only read stored data, never unsaved
  in-memory state.
* Closing the tab: the existing `beforeunload` warning (and `visibilitychange` flush) remain, best effort only.

## Regression reproduction

Before-fix runs used a clean checkout of `b942468` (git worktree outside the repo) with the new spec/helpers
copied in, project `desktop`, port 4392.

| Run | Result |
|---|---|
| Stale Preview, real app, assertions on end state only (`reproduction of the old defect`) | **FAILED before**: after the delayed save completed the URL was `#/preview/<id>` instead of `#/privacy` |
| The 19 navigation tests of the first spec version, before | **16 failed, 3 passed**. Passed before (expected, they describe behaviour that already worked): cover drawn then exit with healthy storage, clean navigation, repeated clicks (same hash) |
| Same spec, after the fix, desktop | 19 passed |
| Full matrix after the fix (final) | **147 passed, 0 failed, 0 flaky, 0 skipped** (7.4 min) |

Before-fix failure points (first failing assertion): URL left `#/edit/` on "All guides", each header link, Back, Back
then Leave, pending cover; the discard test and keyboard test could not find the new controls; the modified-click test
saw the middle-click not prevented.

Test count: 86 (baseline) + 60 (20 x desktop/firefox/webkit) + 1 (mobile) = **147**. Unit: 119 + 7 = **126**.

Slow save is deterministic: the DB is held with a transaction that spins until the test calls `__releaseDb()`; the
tests wait for `data-state="saving"` (the save is provably stuck), perform the clicks, then release. The only timed
wait is one 1.2 s settle in the discard test that is a *negative* check (no stray write), backed by a write counter.

Specific cases covered: failed save then All guides / Home / My guides / Privacy / browser Back (twice, history
length unchanged) / Back then Leave / failure on the exit click itself; pending cover (redaction) with a failing
save, and a cover drawn just before leaving with healthy storage; text edits throughout; backup file contains the unsaved
text; Retry; discard leaves another guide and the stored guide untouched and writes nothing later; Keep editing;
keyboard-only flow; Ctrl/Cmd-click and middle-click with pending and saved edits; slow-save + Back; mobile
(Pixel 7 profile) failure and recovery by tap, with controls inside the viewport and no horizontal overflow.

## After-fix results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass, 0 warnings |
| Unit | `npm test` | 12 files, **126 passed** |
| Build | `npm run build` | pass |
| Audit (separate) | `npm audit --audit-level=low` | **0 vulnerabilities** (exit 0) |
| Browser | full matrix, port 4391, `QA_SHOTS=1` | **147 passed** |
| Existing Preview-save tests | `autosave-preview.spec.ts` (5 x 3 engines) | all passed, unmodified |
| Existing thumbnail / atomic-import tests | `studio-thumbnail`, `robustness` import, Studio/projectIO unit tests | all passed, assertions unmodified |

An earlier full run of the fixed code (before the router hardening below) had 4 WebKit failures: three were the
import-snapshot race described above (fixed by waiting for the DB), one was my own new test pressing Forward before
the Studio had rendered (the test now waits for the page; the router additionally ignores a bypass whose hash does not
match, and the editor resumes autosave if a discard did not lead anywhere). The final full run is the one reported.

## Test infrastructure notes

* The "Saved" label is true before the first autosave; `expectStored` waits for the stored data instead.
* (Superseded - see the continuation section.) `createGuide` used to re-fill the guide name if it was found empty
  (cold-start WebKit flake); that silent retyping has been removed.

## Screenshots (new; existing release screenshots untouched)

`docs/qa/maintenance-final/`: `held-all-guides-{desktop,firefox,webkit}.png`, `held-browser-back-*.png`,
`held-pending-cover-*.png`, `held-phone.png` (the error state: "Not saved", banner with the unsaved-changes
explanation, Retry, backup, Keep editing, Leave without saving). They use the fictional test guides. The "storage is
full" text comes from the injected quota fault.

## Workflow: structural checks vs unexecuted GitHub checks

Done locally: `node docs/qa/maintenance-final/validate-workflows.mjs <repo>` parses `ci.yml` with `js-yaml` (already
in `node_modules` through ESLint; not a project dependency) and asserts triggers, permissions, `needs`, the deploy
condition, matrix, pinned `github.sha` checkouts, a single workflow file; output in `workflow-validation.log`
(all pass). Its success/fail/cancel/skip table is a hand-written model, **not** GitHub output.

**Not done and still a release gate:** any real GitHub run; required-status-check and `github-pages` environment
branch settings; behaviour of `upload-pages-artifact` in the `check` job on GitHub. See
`docs/release-workflow-risk.md`.

## Remaining limitations

* Closing a tab/browser or mobile page reclamation can lose the last unsaved edit; `beforeunload` is best effort.
* Entries created before this version (no `history.state` stamp) are treated as new entries by the guard; this only
  matters for a tab left open across an upgrade.
* Middle-click suppression was verified on Playwright's Chromium, Firefox and WebKit engines, not real Safari, iOS
  or Android. Context-menu "open in new tab" cannot be intercepted.
* The Arabic strings added here have not been reviewed by a native speaker.
* Two WebKit flakes of the starting code (see Baseline): the guide-name reset was narrowed to a render-phase reset in `Dialog.tsx` (see continuation; not proven by sampling); the other remains unexplained.
* `npm audit` reports 0 now; it can fail later on a new advisory and, by design, will then block publishing.

## Continuation: review-close run (2026-10-29)

Scope: two targeted checks and one documentation correction raised by an independent review. The earlier
numbers above (126 unit, 147 browser, audit 0) are the **previous author run's logs**, not independent QA and
not re-executed for this section except where "executed now" is stated.

### 1. Fast successful save, then browser Back

* **Reproduced (router only, real browser history):** `e2e/router-history.spec.ts` bundles the repository's own
  `src/router.ts` with the locked Vite into a blank page (no React app, no storage; a stub guard approves in a
  microtask). Before the fix, on Chromium the immediate approval left the URL on `#/studio` and the route
  unchanged (fails, 9 s poll timeout). Firefox passed the same test before the fix. WebKit was unreliable
  before the fix because of my harness (multi-entry traversal, a React render race), which I corrected by
  waiting for the render and dropping the `history.go(-2)` case; after that WebKit passed 24/24 repeated runs.
* **Full app:** the new test "browser Back with a FAST successful save" passed on Chromium and WebKit before
  the fix, and failed on Firefox in 1 of 3 runs (stayed on the editor URL after Back; the one-off was not
  repeated more times before the fix, so this is weak evidence). So the full app is **only intermittently
  reproduced**, and the router-level race is the confirmed defect. These timings are harness conditions, not
  thresholds. No data loss was observed (the edit was stored in every run).
* **Fix (`src/router.ts`, event/state based, no timers):** when a guard holds a request, the router marks the
  rollback traversal (`history.go(-delta)`) as in flight. An approval (`proceed`) that arrives during that
  window is parked and runs from the rollback's own `hashchange`. A genuinely new request discards a parked
  approval (newest wins). Approval after the rollback has finished behaves as before. Link `proceed()` uses the
  same helper. No routing framework, no change to the guard interface or the Editor.
* After the fix: router spec 5 tests x 3 engines pass (60/60 with `--repeat-each=4`); the app test passed 30/30
  (10 x 3 engines).

### 2. Guide creation without silent input retries

* `createGuide` no longer wraps `fill()` in `expect(...).toPass()`. It waits for observed readiness (dialog
  visible, name field focused by the dialog's own initialization, editable), types each field once and then
  asserts both values. No refill, no sleeps, no whole-test retry.
* `e2e/guide-create.spec.ts` (new): cold start in a fresh browser context x3 (each field typed once; values
  observed for 500 ms after typing, never empty; title and description verified in the stored guide), reopen
  after Cancel (fields reset, one entry suffices), rename (initial value, single edit, keyboard Enter).
* First results: 9/9 on the three engines and 24/24 on WebKit (`--repeat-each=8`), so the first conclusion was
  "not reproduced". Later, repeating the rename test on WebKit **did** reproduce it with no retry in place:
  1 failure in 12, 1 in 30 and (with a diagnostic page script) 1 in 60 cold starts. In the failing run the `input`
  event carried the typed text, yet the name field read back empty and submitting showed "Please give your guide a
  name". So a **post-input reset is real on WebKit, at roughly 1-3 % of runs here**; this is the earlier flake.
* Candidate inspected: `GuideFormDialog` reset the fields in a `useEffect` (after commit) keyed on
  `open/initialTitle/initialDescription`. An effect that lands after the user's first input can overwrite it.
  Fix (`src/components/Dialog.tsx`, narrow): the same reset now happens during render when the dialog goes
  closed -> open or its initial values change, so nothing runs after the commit. Initial/rename values, reopening
  reset and keyboard focus behave as before (covered by the new spec).
* Evidence after the change: 200 consecutive WebKit cold starts with the diagnostic: 0 losses (before: 1 in 60
  and 2 further failures in ~40 spec runs). That is consistent with the cause, **not proof**; at a ~1-3 % rate 200 clean
  runs is strong but not conclusive, and the final matrix below is one more sample (56 WebKit tests, 0 failures).
  A mechanism for why the effect ran late was not isolated.

### 3. Concurrency wording

`ci.yml` comment and `docs/release-workflow-risk.md` corrected: same-group runs serialize; pending runs can be
replaced; execution order is not commit chronology; re-running an older revision is not prohibited; the
guarantee is verification of the deployed revision, not prevention of publishing an older one. The workflow
itself (topology, SHA checkouts, artifacts, main-only deploy, permissions) is unchanged. Real GitHub execution
remains a later authorized gate.

### Final checks executed now

Executed now (this run, logs in the private `review-close-20261029-173550-053` directory, after the last code change):

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass |
| `npm test` (unit) | 12 files, **126 passed** (no new unit tests; the router regression is a browser test) |
| `npm run build` | pass |
| `npm audit --audit-level=low` | 0 vulnerabilities |
| Browser matrix (temporary ignored config, port 4391, all four projects, `reuseExistingServer=false`, no retries) | **174 passed, 0 failed, 0 skipped**: desktop 56, firefox 56, webkit 56, mobile 6 (previous 147 + 5 router + 1 fast-Back + 3 guide-create per engine) |
| `validate-workflows.mjs` | 33 PASS, 0 FAIL (structural only) |

Not done: real GitHub run; real Safari/iOS/Android; screen-reader audit; live-site verification; a complete
security audit. The WebKit reset rate is too low to prove the fix by sampling alone.
