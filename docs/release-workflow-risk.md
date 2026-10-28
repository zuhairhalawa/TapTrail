# Release workflow risk: publishing before browser tests pass

Status: **documented only**. No workflow was changed in this maintenance run.
Reviewed files: `.github/workflows/ci.yml`, `.github/workflows/pages.yml` (at the commit this branch was cut from).

## What the two workflows do today

| | `ci.yml` (CI) | `pages.yml` (Deploy to GitHub Pages) |
|---|---|---|
| Triggers | push to `main`, every pull request | push to `main`, manual `workflow_dispatch` |
| Typecheck, lint, unit tests, build | yes (`check` job) | yes (`build` job) |
| `npm audit --audit-level=low` | yes | no |
| Browser tests (Playwright: desktop Chromium, Firefox, WebKit, mobile) | **yes** (`e2e` job, `needs: check`) | **no** |
| Publishes the site | no | yes (`deploy` job) |

The two workflows are independent: nothing in `pages.yml` waits for, reads, or depends on the result of `ci.yml`.

## The risk

1. **A push to `main` starts both workflows at the same moment.** `pages.yml` builds and deploys after only typecheck, lint, unit tests and the build. The browser matrix in `ci.yml` is still running (or has already failed) while the site is being published. A commit that breaks only in a real browser reaches the public site anyway.
2. **The defects fixed on this branch are exactly that class.** The Studio thumbnail leak (pixels), the import orphan images (real IndexedDB), and the Preview save race (event/transaction timing) are not detectable by jsdom unit tests. Two of them are privacy/data-integrity problems; only the browser tests prove them fixed.
3. **`workflow_dispatch` on `pages.yml` redeploys whatever it is run on with the same reduced checks.** It also has no `npm audit` step.
4. **Branch protection is unknown.** Pull requests do run the e2e matrix, but whether a failing `e2e` job blocks merging depends on repository settings (required status checks), which this run could not and did not inspect. If they are not required, a red `e2e` run does not stop a merge to `main`, and therefore does not stop the deploy.
5. `cancel-in-progress: true` on both concurrency groups means a rapid second push can cancel a CI run midway while the Pages run for that commit may complete, again leaving a published build with no completed browser verdict.

## Operational mitigation until the workflows are changed

- Do not merge to `main` (which publishes) until the `e2e` matrix for the exact commit is green on the pull request, and treat all four matrix legs (`desktop`, `firefox`, `webkit`, `mobile`) as required.
- Never tag or dispatch a release from a commit whose CI run is incomplete, cancelled or red.
- After a publish, check the live site manually; this repository's tests do not exercise the deployed site.

## Suggested follow-up (not done here, needs its own change + review)

- Make deployment depend on the full CI result, e.g. trigger `pages.yml` from `workflow_run` of `CI` with `conclusion == 'success'` on `main`, or move the `e2e` matrix into the Pages workflow as a `needs:` of `deploy`.
- Mark `Typecheck, lint, unit tests, build` and the four `Browser tests (...)` jobs as required status checks for `main`.
- Add `npm audit` (or drop it from CI) so both paths gate on the same checks.