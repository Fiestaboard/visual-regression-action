# Visual Regression Action

Visual regression testing for GitHub Actions — baselines live in build artifacts, not your git history.

## How it works

- **Pushes to your default branch publish a `vrt-baseline` artifact.** No screenshots are committed to git.
- **Pull requests download the latest baseline from the base branch, diff it against the PR's screenshots, and report the result** — a sticky PR comment, a step summary, and a downloadable HTML report.
- **Merging the PR is the approval.** There's no "update baselines" step: once the PR lands, the default branch rebuilds and publishes fresh baselines automatically.

If the baseline artifact is missing or expired (GitHub Actions artifacts expire after at most 90 days), every screenshot reports as "new," the job passes with a note, and the next default-branch build self-heals by publishing a new baseline.

The baseline used for comparison is the **newest baseline artifact on the branch**, even if that run later failed — the action does not check the producing run's conclusion. Keep your baseline-upload step after your capture step succeeds so a broken run doesn't publish a bad baseline.

Screenshot *capture* is out of scope — bring your own tool (Playwright, Storybook, Cypress, ...) and point this action at the directory it writes PNGs to. See [examples/playwright.yml](examples/playwright.yml) and [examples/storybook.yml](examples/storybook.yml).

## Quick start

```yaml
name: Visual tests
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:   # manual "Run workflow" republishes the baseline

permissions:
  contents: read
  actions: read        # download baseline artifacts from other runs
  pull-requests: write # sticky results comment

jobs:
  vrt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ... capture screenshots into ./screenshots with your tool of choice ...
      - uses: fiestaboard/visual-regression-action@v1
        with:
          screenshots-dir: ./screenshots
```

On a push to `main` this publishes a baseline. On a pull request it downloads the base branch's baseline, diffs, and reports — no other configuration required.

## Inputs

| Input | Default | Description |
|---|---|---|
| `screenshots-dir` | *(required)* | Directory containing the captured PNG screenshots |
| `github-token` | `${{ github.token }}` | Token used to look up/download baseline artifacts and post the PR comment |
| `mode` | `auto` | auto \| baseline \| compare. auto = pull requests compare, pushes to the default branch publish baselines |
| `key` | `''` | Optional suffix for artifact names — use for matrix builds or multiple apps in one repo |
| `threshold` | `0.1` | Per-pixel color sensitivity passed to pixelmatch (0-1, smaller = more sensitive) |
| `diff-ratio` | `0` | Fraction of differing pixels (0-1) above which an image counts as changed |
| `fail-on-diff` | `true` | Fail the job when screenshots changed or were removed |
| `comment` | `true` | Post/update a sticky PR comment with the results |
| `baseline-branch` | `''` | Branch whose baseline artifact to compare against. Defaults to the PR base branch (or the default branch) |
| `retention-days` | `''` | Artifact retention override in days (empty = repo default) |

## Outputs

| Output | Description |
|---|---|
| `changed` | Number of changed screenshots |
| `added` | Number of added screenshots |
| `removed` | Number of removed screenshots |
| `unchanged` | Number of unchanged screenshots |
| `has-changes` | `true` when changed + removed > 0 |
| `report-path` | Local path of the generated HTML report |

Baseline mode (a push to the default branch) sets no outputs — there's nothing to compare yet.

## The report

Results surface in three places:

1. **Sticky PR comment** — a pass/fail headline, a counts table, and a direct download link for the report artifact, updated in place on every push (never spammed as a new comment each time).
2. **`$GITHUB_STEP_SUMMARY`** — the same summary rendered on the workflow run page.
3. **Downloadable `vrt-report[-<key>]` artifact** — a single self-contained `index.html`. Each changed screenshot gets a large comparison stage with three views: **Swipe** (drag a divider between baseline and current), **Overlay** (the current screenshot with detected changes highlighted in pink), and **Side-by-side** (baseline / current / diff thumbnails). A **fullscreen reviewer** steps through every change: `←`/`→` to move between screenshots, `S`/`O`/`D` to switch views, scroll to zoom, drag to pan, `Esc` to close. No external requests; open it locally after downloading.

The report inlines every screenshot as a base64 data URI directly in the HTML, so very large suites (many or very large screenshots) produce a correspondingly large artifact — keep screenshots reasonably sized (e.g. viewport-cropped rather than full-page where possible) if this becomes a concern.

## Approving changes

An intentional visual change leaves the check red — and if the check is required by branch protection, you need a way to accept it without weakening the gate. That's what `/vrt approve` is for:

1. Open the report and hit **Review changes**. Approve (`A`) or reject (`R`) each screenshot as you step through.
2. The report assembles a command as you go, e.g. `/vrt approve home.png@1a2b3c4d5e6f old.png@9f8e7d6c5b4a` — each entry pins a hash of that screenshot's exact pixels. Copy it.
3. Post it as a comment on the PR. If you've added the [approvals workflow](examples/vrt-approvals.yml), the failed check reruns automatically (the comment gets a 👀 when the rerun kicks off); otherwise hit "Re-run failed jobs" yourself.
4. On the rerun, the action reads the PR's comments, honors approvals whose hashes still match, and passes when every changed/removed screenshot is approved. Approved items stay visible in the report and comment, marked ✅.

Details worth knowing:

- Only comments from users with an `OWNER`, `MEMBER`, or `COLLABORATOR` association count. Approvals are ordinary PR comments, so there's a permanent audit trail of who accepted what.
- The hash pin means an approval covers *those exact pixels*. Push another change to the same screenshot and the stale approval silently stops matching — the check goes red again.
- `/vrt approve all` bulk-approves every changed/removed screenshot — but only while the head it was posted against is still the PR head; any newer push invalidates it. `/vrt approve all@<commit-sha>` (7+ hex chars) is the explicit, commit-pinned form.
- Approvals only greenlight the check; baselines still update the normal way, when the merge lands and your default branch republishes them.
- Screenshot names containing whitespace can't be approved individually — use `all@<sha>`.

To enable auto-rerun, add this second workflow ([examples/vrt-approvals.yml](examples/vrt-approvals.yml)):

```yaml
name: VRT approvals
on:
  issue_comment:
    types: [created]
permissions:
  contents: read
jobs:
  approve:
    if: ${{ github.event.issue.pull_request && startsWith(github.event.comment.body, '/vrt approve') }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: write        # rerun the failed visual check
      issues: write         # rocket reaction on the approval comment
      pull-requests: write  # (reactions on PR comments use this scope too)
    steps:
      - uses: fiestaboard/visual-regression-action@v1
        with:
          mode: approve
```

## Recipes

**Multiple workflows in one repo** — if more than one workflow file runs this action (not just multiple steps in the same workflow), give each workflow its own `key` too; otherwise their baseline artifacts share a name and can cross-contaminate each other's comparisons.

**Matrix builds / multiple apps in one repo** — give each invocation a distinct `key` so artifact names don't collide (`vrt-baseline-<key>`, `vrt-report-<key>`):

```yaml
- uses: fiestaboard/visual-regression-action@v1
  with:
    screenshots-dir: ./screenshots
    key: ${{ matrix.browser }}
```

**Report-only mode** — never fail the check, but still branch on whether anything changed:

```yaml
- uses: fiestaboard/visual-regression-action@v1
  id: vrt
  with:
    screenshots-dir: ./screenshots
    fail-on-diff: 'false'
- if: steps.vrt.outputs.has-changes == 'true'
  run: echo "Visuals changed — see the PR comment"
```

**Comparing against a non-default branch** — override which branch's baseline to diff against:

```yaml
- uses: fiestaboard/visual-regression-action@v1
  with:
    screenshots-dir: ./screenshots
    baseline-branch: release
```

**Monorepos** — run the action twice with different `key` and `screenshots-dir` values, one per app:

```yaml
- uses: fiestaboard/visual-regression-action@v1
  with:
    screenshots-dir: ./apps/web/screenshots
    key: web
- uses: fiestaboard/visual-regression-action@v1
  with:
    screenshots-dir: ./apps/admin/screenshots
    key: admin
```

## Fork PRs & permissions

Pull requests from forks run with a read-only `GITHUB_TOKEN` and can't be granted `pull-requests: write`. Diffing and reporting still work — the base branch's baseline is public and downloadable, and the HTML report still uploads as an artifact and appears in the step summary. Only the sticky PR comment is skipped, since posting it requires write access this token doesn't have.

The permissions block in the quick start is the full requirement:

```yaml
permissions:
  contents: read
  actions: read        # download baseline artifacts from other runs
  pull-requests: write # sticky results comment
```

## FAQ

**Why is my check red after an intentional visual change?**
That's the design: a changed or removed screenshot fails the job by default (`fail-on-diff: true`) so the change gets a deliberate look before merge. To accept it, use the [approval flow](#approving-changes) — review in the report, post the generated `/vrt approve` command, and the check goes green. Once merged, the default branch rebuilds and publishes the new baseline automatically. If you'd rather never fail the check, run [report-only mode](#recipes) and branch on `has-changes` instead.

**What if the baseline expired or got deleted?**
Nothing breaks — compares report everything as "new" and pass with a note until a baseline exists again. To republish one on demand, keep `workflow_dispatch:` in your workflow's triggers and hit "Run workflow" on your default branch (manual runs and `schedule` runs publish baselines in auto mode). Quiet repo? Add a monthly cron so the baseline never ages out of artifact retention:

```yaml
on:
  schedule:
    - cron: '0 6 1 * *'  # monthly baseline keep-alive
```

**What happens on the very first run?**
There's no baseline artifact yet, so every screenshot reports as "new." The job passes with a note. The first push to your default branch after that publishes the initial baseline, and PRs after that compare normally.

**Do artifacts cost money?**
Baseline and report artifacts count toward your repository's Actions storage quota like any other artifact. Use `retention-days` to shorten how long they're kept if storage is a concern; GitHub also expires artifacts automatically after at most 90 days regardless of setting, at which point the next default-branch build self-heals the baseline.

**Which run's baseline gets used?**
The newest non-expired `vrt-baseline[-<key>]` artifact whose producing run is on the base branch — regardless of whether that run ultimately succeeded or failed. This is a deliberate v1 simplification: the action does not walk run conclusions, it just picks the newest matching artifact. If a run can fail after uploading the baseline, move the baseline-upload step after your capture step succeeds.

## License

[MIT](LICENSE)
