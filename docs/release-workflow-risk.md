# Release workflow: how Pages publishing is gated

Status: **implemented locally, not yet executed on GitHub.** The structure is validated locally
(`docs/qa/maintenance-final/validate-workflows.mjs`, output in `workflow-validation.log`), but no
workflow run has happened with these files. See "What still needs GitHub" below.

## The original risk (release `0331c8f`, repair branch `b942468`)

There were two independent workflows:

| | `ci.yml` (CI) | `pages.yml` (Deploy to GitHub Pages) |
|---|---|---|
| Triggers | push to `main`, every pull request | push to `main`, manual `workflow_dispatch` |
| Typecheck, lint, unit tests, build | yes | yes |
| `npm audit --audit-level=low` | yes | **no** |
| Browser tests (desktop Chromium, Firefox, WebKit, mobile) | yes | **no** |
| Publishes the site | no | yes |

A push to `main` started both at once. `pages.yml` published after only typecheck, lint, unit tests and
the build, while the browser matrix (and the audit) was still running or had already failed. A manual
`workflow_dispatch` of `pages.yml` skipped them in the same way, and `cancel-in-progress: true` could
cancel a CI run while the Pages run for the same commit completed. Whether a red `e2e` job blocked a merge
depended on repository settings that cannot be read from the code.

Unit tests (jsdom, fake IndexedDB) cover important parts of the defects fixed in this line of work
(for example the redaction painting, the atomic import and the save-then-preview ordering). They cannot
show how a real browser lays out, schedules and persists things. The real-browser Playwright tests add
that integration evidence (real pixels in the displayed thumbnail, real IndexedDB transactions, real
history navigation and focus), and they run on three engines.

## What the workflow does now

`pages.yml` was removed. `.github/workflows/ci.yml` is the only workflow and the only publishing path.

```
check  (Typecheck, lint, unit tests, build, npm audit; packages dist on main)
  └─ e2e  (Browser tests: desktop, firefox, webkit, mobile)   needs: check
       └─ deploy  (Deploy to GitHub Pages)                    needs: [check, e2e]
```

* **Same revision.** Every job checks out `github.sha` explicitly. `deploy` checks out nothing: it publishes
  the `dist/` artifact that the `check` job built from that same commit, after that commit passed everything.
  There is no step that resolves "the tip of main" again.
* **Complete verification.** `deploy` has `needs: [check, e2e]` and its `if` has no status function, so GitHub
  adds the implicit `success()`: it runs only if every needed job succeeded. `e2e` succeeds only if all four
  matrix legs succeeded (`fail-fast: false`, so every leg still reports). A failed, cancelled or skipped
  `check`, or any failed/cancelled leg, means `deploy` is skipped. `npm audit` stays in `check`.
* **Only main publishes.** `deploy` runs only for `github.ref == 'refs/heads/main'` and events other than
  `pull_request`. A manual run on another branch or a tag verifies but does not publish. Manual runs on main
  go through the same `check` and `e2e` jobs, so there is no ungated manual path.
* **Pull requests** run `check` and `e2e` with the workflow default of `contents: read`. The deploy job is
  skipped, the verified build is not even packaged, and no job except `deploy` can request `pages: write` or
  `id-token: write`.
* **Concurrency.** `group: ci-<ref>`, and only pull-request runs cancel earlier runs. Runs in the same group
  execute one at a time (serialized), and runs on main are not cancelled, so a run that is about to publish
  is not killed halfway. A newer *pending* run replaces an older pending one. Execution order is **not** a
  guarantee of commit chronology, and re-running an older revision is not automatically prohibited, so an
  older revision can be deployed later (for example by re-running its workflow). The guarantee here is
  narrower: the revision that is deployed is the one that was checked out by SHA, verified and packaged.
  Blanket prevention of publishing an older revision is not provided and no anti-rollback mechanism was added.
  Reference: <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>.
  Actual GitHub execution of this workflow is still a later, separately authorized release gate.
* **Names.** Job names (`Typecheck, lint, unit tests, build`, `Browser tests (<project>)`) are unchanged, so
  existing required-status-check settings keep matching. The new job is `Deploy to GitHub Pages`.
* Action versions are unchanged (`checkout@v7`, `setup-node@v7`, `upload-artifact@v7`,
  `upload-pages-artifact@v5`, `configure-pages@v6`, `deploy-pages@v5`).

### Outcome by case

| Case | check | e2e | deploy |
|---|---|---|---|
| Push or manual run on `main`, everything green | pass | pass (4/4) | **runs** |
| Any step in `check` fails (including `npm audit`) | fail | skipped | skipped |
| One browser leg fails | pass | fail | skipped |
| A leg or the run is cancelled | pass/cancelled | cancelled | skipped |
| Pull request | pass | pass | skipped (condition) |
| Manual run on a feature branch or tag | pass | pass | skipped (condition) |

## What was verified locally, and what still needs GitHub

Verified locally (structure only, no execution): the YAML parses; triggers, permissions, `needs`, the
`deploy` condition, matrix contents, pinned checkouts and the single-workflow property are asserted by
`validate-workflows.mjs`. The success/failure/cancel/skipped table above is a hand-written model of GitHub's
documented `needs` / implicit `success()` semantics; it was not produced by GitHub.

Still release gates, to be checked after an authorized push (nothing was pushed, merged, tagged or deployed
in this run):

1. A real run on a pull request: all five checks green, `Deploy to GitHub Pages` skipped.
2. A real run on `main`: `deploy` waits for all four browser legs.
3. Repository settings, which cannot be seen from the code: mark `Typecheck, lint, unit tests, build` and the
   four `Browser tests (...)` jobs as required status checks for `main`, and restrict the `github-pages`
   environment to the `main` branch (defence in depth next to the `if`).
4. Whether an `npm audit` failure on an unrelated new advisory blocking a release is acceptable operationally.
5. The existing site still deploys with the repackaged artifact (`upload-pages-artifact` now runs in `check`).

## Operational notes

* Do not tag or dispatch a release from a commit whose run is incomplete, cancelled or red.
* After a publish, check the live site; the tests do not exercise the deployed site.
* The project importer stops with a "too large" error once the re-encoded images it is holding for the single
  commit exceed `LIMITS.maxImportFileBytes` (`heldBytes` in `src/lib/projectIO.ts`). That bounds the
  *retained processed image buffers*. It is not a bound on total process memory: the source file text, the
  base64 decode, bitmap decoding, re-encoding and the browser itself allocate more, transiently. It was not
  changed in this run.