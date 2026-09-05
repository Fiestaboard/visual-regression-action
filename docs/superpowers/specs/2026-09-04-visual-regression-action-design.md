# Visual Regression Action — Design Spec

**Date:** 2026-09-04
**Repo:** `Fiestaboard/visual-regression-action` (used as `fiestaboard/visual-regression-action@v1`)
**Status:** Approved

## Problem

Teams doing visual regression testing (VRT) typically commit baseline screenshots to
their repo. This bloats git history, generates noisy diffs, and requires a manual
"update baselines" ritual. Fiestaboard does this today and it sucks.

## Solution

A reusable TypeScript GitHub Action that:

1. Stores baseline screenshots as **GitHub Actions artifacts produced by the default
   branch's build** — never in git.
2. On pull requests, downloads the latest baseline artifact from the base branch,
   diffs it against the PR's freshly captured screenshots, and reports.
3. Generates a **self-contained HTML report** (side-by-side baseline / current / diff)
   plus a **sticky PR comment** and a **run step summary**.

Screenshot *capture* is explicitly out of scope: teams capture PNGs with whatever
tool they like (Playwright, Storybook, Cypress...) and point this action at the
directory. The action only compares and reports.

**Merge is the approval.** There is no "accept changes" step: merging a PR causes the
default branch to rebuild and publish new baselines automatically.

## Architecture

One action, two modes, auto-detected from the triggering event (overridable via
`mode` input):

### Baseline mode (push to default branch)

Upload `screenshots-dir` as artifact `vrt-baseline` (plus `-<key>` suffix when the
`key` input is set, for matrix builds / multiple apps). Always succeeds.

### Compare mode (pull_request)

1. Via the GitHub API (`github-token`), find the newest non-expired
   `vrt-baseline[-<key>]` artifact whose producing run is on the base branch
   (regardless of that run's final conclusion — this is a deliberate v1
   simplification, not a check for run success); download and extract it.
2. Diff baseline vs. `screenshots-dir` (matched by relative path).
3. Generate report surfaces (HTML artifact, PR comment, step summary).
4. Upload the HTML report as artifact `vrt-report[-<key>]`.
5. Set outputs; fail the job per the rules below.

**Missing/expired baseline** (first run, or >90-day artifact retention lapse): all
screenshots reported as *new*, job passes with a note. Next default-branch build
self-heals. This is accepted behavior — a main branch idle >90 days doesn't need VRT.

## Diff engine

- `pixelmatch` + `pngjs` — pure JS, no native deps, bundles cleanly with ncc.
- Buckets per relative path: **changed**, **added** (no baseline), **removed**
  (baseline only), **unchanged**.
- `threshold` input: pixelmatch per-pixel color sensitivity (default `0.1`).
- `diff-ratio` input: fraction of differing pixels above which an image counts as
  changed (default `0` — any differing pixel counts).
- Dimension mismatch: always **changed**; diff rendered on a union-sized canvas.

## Inputs

| Input | Default | Purpose |
|---|---|---|
| `screenshots-dir` | (required) | Directory of captured PNGs |
| `github-token` | `${{ github.token }}` | API access for artifact lookup + comment |
| `mode` | `auto` | `auto` \| `baseline` \| `compare` |
| `key` | `''` | Artifact name suffix for matrix/multi-app setups |
| `threshold` | `0.1` | Pixelmatch per-pixel sensitivity |
| `diff-ratio` | `0` | Changed-pixel fraction that counts as a change |
| `fail-on-diff` | `true` | Fail the job on changed/removed screenshots |
| `comment` | `true` | Post/update the sticky PR comment |
| `retention-days` | `''` | Optional artifact retention override |

`mode: auto` resolves: `pull_request`/`pull_request_target` → compare; push to the
repo's default branch → baseline; anything else → error instructing an explicit mode.

## Outputs

`changed`, `added`, `removed`, `unchanged` (counts), `has-changes` (bool),
`report-path` (local path to the generated HTML report).

## Pass/fail semantics

- Compare mode with `fail-on-diff: true` (default): any **changed** or **removed**
  screenshot → exit non-zero → red PR check. **Added** screenshots never fail.
- `fail-on-diff: false`: report-only; job stays green; teams can branch on the
  `has-changes` output.
- Missing baseline: pass with a note.
- Baseline mode: always passes.
- An intentional visual change means a red check at merge time; that is inherent to
  "merge is the approval" and is the shipped default. Teams that dislike it run
  report-only mode.

## Report surfaces

1. **Sticky PR comment** — pass/fail headline, counts table, changed screenshot
   names, link to the run (where the report artifact lives). Identified by a hidden
   HTML marker comment; updated in place on each push, never spammed. Skipped
   gracefully when the token can't write (fork PRs).
2. **`$GITHUB_STEP_SUMMARY`** — same summary table on the run page.
3. **HTML report artifact** — single self-contained `index.html`, images inlined as
   base64 data URIs, zero external requests. Card per screenshot: baseline /
   current / diff side-by-side, overlay slider for changed images, filter by bucket.

## Permissions (documented in README)

```yaml
permissions:
  actions: read        # download baseline artifact from another run
  pull-requests: write # sticky comment
```

Fork PRs degrade gracefully: diff + report artifact still work; comment is skipped.

## Implementation

- TypeScript, Node 20 action, bundled with `@vercel/ncc`; `dist/` committed.
- Toolkit: `@actions/core`, `@actions/github`, `@actions/artifact`.
- Modules: `main.ts` (orchestration/mode), `baseline.ts` (artifact find/download/
  upload), `diff.ts` (pixelmatch engine), `report.ts` (HTML + markdown summary),
  `comment.ts` (sticky comment).
- Tests: vitest. Diff engine + report generator against fixture PNGs; baseline
  lookup and comment logic against mocked Octokit.
- CI: lint, test, build, dist-up-to-date check, plus a **dogfood e2e workflow** that
  runs baseline mode then compare mode against doctored fixtures and asserts
  outputs.
- Releases: tags `v1.x.y` with floating `v1` major tag. README includes copy-paste
  workflows (Playwright example, Storybook example).

## Out of scope

- Screenshot capture.
- Non-PNG formats.
- Cross-repo baselines.
- A hosted/public report URL (GitHub Pages) — may come later.
