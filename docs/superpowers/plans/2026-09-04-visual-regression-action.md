# Visual Regression Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable TypeScript GitHub Action (`fiestaboard/visual-regression-action@v1`) that stores VRT baselines as artifacts from the default branch's build, diffs PR screenshots against them, and produces an HTML report + sticky PR comment.

**Architecture:** One Node 20 action with two modes: *baseline* (push to default branch → upload screenshots as artifact) and *compare* (PR → download latest baseline artifact from base branch, pixelmatch diff, report). No baselines in git; merging a PR is the approval.

**Tech Stack:** TypeScript, `@actions/core` / `@actions/github` / `@actions/artifact`, `pixelmatch@5` + `pngjs` (pure JS), `@vercel/ncc` bundling (committed `dist/`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-visual-regression-action-design.md`

## Global Constraints

- Node 20 action (`runs.using: node20`), entry `dist/index.js`; `dist/` is committed and CI verifies it is up to date.
- `pixelmatch` must stay at `^5.3.0` (v6+ is ESM-only and breaks the CJS ncc bundle).
- Pure-JS dependencies only (no native modules) so the bundle runs on any runner OS.
- Artifact names: baseline `vrt-baseline` + optional `-<key>` suffix; report `vrt-report` + optional `-<key>` suffix.
- Inputs (kebab-case): `screenshots-dir` (required), `github-token` (default `${{ github.token }}`), `mode` (`auto`|`baseline`|`compare`, default `auto`), `key` (default `''`), `threshold` (default `0.1`), `diff-ratio` (default `0`), `fail-on-diff` (default `true`), `comment` (default `true`), `baseline-branch` (default `''` = PR base branch / default branch), `retention-days` (default `''`).
- Outputs (strings): `changed`, `added`, `removed`, `unchanged`, `has-changes` (`'true'`/`'false'`, true iff changed+removed > 0), `report-path`.
- Fail semantics: compare mode + `fail-on-diff` → fail iff changed+removed > 0. Added screenshots never fail. Missing baseline never fails. Baseline mode never fails (barring real errors).
- Sticky comment marker: `<!-- fiestaboard/visual-regression-action -->`.
- Commit messages: conventional commits (`feat:`, `test:`, `ci:`, `docs:`, `chore:`).

## File Structure

```
action.yml                      # action metadata: inputs/outputs/branding, runs dist/index.js
package.json / tsconfig.json    # toolchain
src/types.ts                    # shared result types
src/mode.ts                     # pure mode-resolution logic
src/diff.ts                     # directory walking + pixelmatch engine
src/report.ts                   # HTML report + markdown summary
src/comment.ts                  # sticky PR comment upsert
src/baseline.ts                 # artifact find/download/upload
src/main.ts                     # orchestration, inputs/outputs, entry point
tests/helpers/png.ts            # programmatic PNG fixture builders
tests/*.test.ts                 # vitest unit tests per module
scripts/make-e2e-fixtures.mjs   # generates PNG dirs for the dogfood e2e job
.github/workflows/ci.yml        # check job (typecheck/test/build/dist-check) + e2e dogfood job
README.md, examples/            # docs + copy-paste workflows
dist/                           # ncc bundle (committed)
```

---

### Task 1: Project scaffold + PNG fixture helper

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `tests/helpers/png.ts`, `tests/helpers/png.test.ts`

**Interfaces:**
- Produces: working `npm test` / `npm run typecheck` / `npm run build` toolchain; `makePng(width, height, rgba)` and `makePngWithRect(width, height, bg, rect)` from `tests/helpers/png.ts`, both returning `Buffer` (encoded PNG).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "visual-regression-action",
  "version": "1.0.0",
  "private": true,
  "description": "Visual regression testing for GitHub Actions with artifact-based baselines — no screenshots in git",
  "main": "dist/index.js",
  "scripts": {
    "build": "ncc build src/main.ts -o dist --license licenses.txt",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "license": "MIT",
  "dependencies": {
    "@actions/artifact": "^2.3.2",
    "@actions/core": "^1.11.1",
    "@actions/github": "^6.0.0",
    "pixelmatch": "^5.3.0",
    "pngjs": "^7.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.17.0",
    "@types/pixelmatch": "^5.2.6",
    "@types/pngjs": "^6.0.5",
    "@vercel/ncc": "^0.38.3",
    "typescript": "^5.6.3",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
e2e-tmp/
*.tsbuildinfo
```

(Note: `dist/` is deliberately NOT ignored — it must be committed.)

- [ ] **Step 4: `npm install`** — expect a lockfile and clean install.

- [ ] **Step 5: Write the failing test `tests/helpers/png.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { makePng, makePngWithRect } from './png';

describe('png helpers', () => {
  it('makePng produces a decodable PNG of the right size and color', () => {
    const buf = makePng(4, 3, [255, 0, 0, 255]);
    const png = PNG.sync.read(buf);
    expect(png.width).toBe(4);
    expect(png.height).toBe(3);
    expect([...png.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it('makePngWithRect paints the rect color inside and bg outside', () => {
    const buf = makePngWithRect(10, 10, [0, 0, 255, 255], { x: 2, y: 2, w: 3, h: 3, color: [0, 255, 0, 255] });
    const png = PNG.sync.read(buf);
    const px = (x: number, y: number) => [...png.data.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 4)];
    expect(px(0, 0)).toEqual([0, 0, 255, 255]);
    expect(px(3, 3)).toEqual([0, 255, 0, 255]);
  });
});
```

- [ ] **Step 6: Run `npx vitest run tests/helpers/png.test.ts`** — expect FAIL (module not found).

- [ ] **Step 7: Write `tests/helpers/png.ts`**

```ts
import { PNG } from 'pngjs';

export type RGBA = [number, number, number, number];

export function makePng(width: number, height: number, rgba: RGBA): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

export function makePngWithRect(
  width: number,
  height: number,
  bg: RGBA,
  rect: { x: number; y: number; w: number; h: number; color: RGBA }
): Buffer {
  const png = PNG.sync.read(makePng(width, height, bg));
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * width + x) * 4;
      png.data[i] = rect.color[0];
      png.data[i + 1] = rect.color[1];
      png.data[i + 2] = rect.color[2];
      png.data[i + 3] = rect.color[3];
    }
  }
  return PNG.sync.write(png);
}
```

- [ ] **Step 8: Run `npx vitest run tests/helpers/png.test.ts`** — expect PASS. Also run `npm run typecheck` — expect clean.

- [ ] **Step 9: Commit** — `chore: scaffold TypeScript action project with PNG test helpers`

---

### Task 2: Shared types + mode resolution

**Files:**
- Create: `src/types.ts`, `src/mode.ts`, `tests/mode.test.ts`

**Interfaces:**
- Produces:
  - `src/types.ts`: `type Status = 'changed' | 'added' | 'removed' | 'unchanged'`; `interface ScreenshotResult { name: string; status: Status; diffRatio: number; baselinePng?: Buffer; currentPng?: Buffer; diffPng?: Buffer }`; `interface CompareSummary { results: ScreenshotResult[]; changed: number; added: number; removed: number; unchanged: number; hasChanges: boolean }`.
  - `src/mode.ts`: `resolveMode(modeInput: string, eventName: string, ref: string, defaultBranch: string): 'baseline' | 'compare'` — throws `Error` with actionable message when unresolvable.

- [ ] **Step 1: Write `src/types.ts`**

```ts
export type Status = 'changed' | 'added' | 'removed' | 'unchanged';

export interface ScreenshotResult {
  /** Relative path within the screenshots dir, posix separators. */
  name: string;
  status: Status;
  /** Fraction of pixels differing (0 for added/removed/unchanged). */
  diffRatio: number;
  baselinePng?: Buffer;
  currentPng?: Buffer;
  diffPng?: Buffer;
}

export interface CompareSummary {
  results: ScreenshotResult[];
  changed: number;
  added: number;
  removed: number;
  unchanged: number;
  /** True iff changed + removed > 0. Added screenshots never count. */
  hasChanges: boolean;
}
```

- [ ] **Step 2: Write the failing tests `tests/mode.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveMode } from '../src/mode';

describe('resolveMode', () => {
  it('honors explicit modes regardless of event', () => {
    expect(resolveMode('baseline', 'pull_request', 'refs/pull/1/merge', 'main')).toBe('baseline');
    expect(resolveMode('compare', 'push', 'refs/heads/main', 'main')).toBe('compare');
  });

  it('auto: pull_request events compare', () => {
    expect(resolveMode('auto', 'pull_request', 'refs/pull/1/merge', 'main')).toBe('compare');
    expect(resolveMode('auto', 'pull_request_target', 'refs/heads/main', 'main')).toBe('compare');
  });

  it('auto: push to default branch is baseline', () => {
    expect(resolveMode('auto', 'push', 'refs/heads/main', 'main')).toBe('baseline');
  });

  it('auto: push to non-default branch throws', () => {
    expect(() => resolveMode('auto', 'push', 'refs/heads/feature', 'main')).toThrow(/explicit/i);
  });

  it('auto: other events throw', () => {
    expect(() => resolveMode('auto', 'workflow_dispatch', 'refs/heads/main', 'main')).toThrow(/explicit/i);
  });

  it('invalid mode input throws', () => {
    expect(() => resolveMode('bogus', 'push', 'refs/heads/main', 'main')).toThrow(/mode/i);
  });
});
```

- [ ] **Step 3: Run `npx vitest run tests/mode.test.ts`** — expect FAIL.

- [ ] **Step 4: Write `src/mode.ts`**

```ts
export function resolveMode(
  modeInput: string,
  eventName: string,
  ref: string,
  defaultBranch: string
): 'baseline' | 'compare' {
  if (modeInput === 'baseline' || modeInput === 'compare') return modeInput;
  if (modeInput !== 'auto') {
    throw new Error(`Invalid mode "${modeInput}". Use "auto", "baseline", or "compare".`);
  }
  if (eventName === 'pull_request' || eventName === 'pull_request_target') return 'compare';
  if (eventName === 'push' && ref === `refs/heads/${defaultBranch}`) return 'baseline';
  throw new Error(
    `Cannot auto-detect mode for event "${eventName}" on ref "${ref}". ` +
      `Set an explicit mode: "baseline" or "compare".`
  );
}
```

- [ ] **Step 5: Run `npx vitest run tests/mode.test.ts`** — expect PASS.

- [ ] **Step 6: Commit** — `feat: add shared types and mode resolution`

---

### Task 3: Diff engine

**Files:**
- Create: `src/diff.ts`, `tests/diff.test.ts`

**Interfaces:**
- Consumes: `ScreenshotResult`, `CompareSummary` from `src/types.ts`; `makePng`/`makePngWithRect` from `tests/helpers/png.ts`.
- Produces (`src/diff.ts`):
  - `listPngs(dir: string): string[]` — recursive, returns sorted posix-style relative paths of `*.png` files; returns `[]` if dir missing.
  - `compareDirectories(baselineDir: string, currentDir: string, opts: { threshold: number; diffRatio: number }): CompareSummary`.

- [ ] **Step 1: Write the failing tests `tests/diff.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareDirectories, listPngs } from '../src/diff';
import { makePng, makePngWithRect } from './helpers/png';

function tmpDirs(): { base: string; curr: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vrt-'));
  const base = path.join(root, 'base');
  const curr = path.join(root, 'curr');
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(curr, { recursive: true });
  return { base, curr };
}

function write(dir: string, name: string, buf: Buffer): void {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const RED: [number, number, number, number] = [255, 0, 0, 255];

describe('listPngs', () => {
  it('finds nested pngs as sorted posix relative paths, ignores non-png', () => {
    const { base } = tmpDirs();
    write(base, 'b/inner.png', makePng(2, 2, WHITE));
    write(base, 'a.png', makePng(2, 2, WHITE));
    write(base, 'notes.txt', Buffer.from('hi'));
    expect(listPngs(base)).toEqual(['a.png', 'b/inner.png']);
  });

  it('returns [] for a missing directory', () => {
    expect(listPngs('/definitely/not/here')).toEqual([]);
  });
});

describe('compareDirectories', () => {
  it('identical images are unchanged', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(50, 50, WHITE));
    write(curr, 'a.png', makePng(50, 50, WHITE));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 });
    expect(s.unchanged).toBe(1);
    expect(s.hasChanges).toBe(false);
    expect(s.results[0].diffRatio).toBe(0);
  });

  it('a differing region marks the image changed with a diff PNG and ratio', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(100, 100, WHITE));
    write(curr, 'a.png', makePngWithRect(100, 100, WHITE, { x: 0, y: 0, w: 10, h: 10, color: RED }));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 });
    expect(s.changed).toBe(1);
    expect(s.hasChanges).toBe(true);
    const r = s.results[0];
    expect(r.diffRatio).toBeCloseTo(0.01, 3);
    expect(r.diffPng).toBeInstanceOf(Buffer);
    expect(r.baselinePng).toBeInstanceOf(Buffer);
    expect(r.currentPng).toBeInstanceOf(Buffer);
  });

  it('diffRatio tolerance masks small changes', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(100, 100, WHITE));
    write(curr, 'a.png', makePngWithRect(100, 100, WHITE, { x: 0, y: 0, w: 10, h: 10, color: RED }));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0.05 });
    expect(s.changed).toBe(0);
    expect(s.unchanged).toBe(1);
  });

  it('dimension mismatch is always changed, even with a high diffRatio', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(50, 50, WHITE));
    write(curr, 'a.png', makePng(60, 40, WHITE));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0.99 });
    expect(s.changed).toBe(1);
    expect(s.results[0].diffPng).toBeInstanceOf(Buffer);
  });

  it('buckets added and removed screenshots', () => {
    const { base, curr } = tmpDirs();
    write(base, 'gone.png', makePng(10, 10, WHITE));
    write(base, 'same.png', makePng(10, 10, WHITE));
    write(curr, 'same.png', makePng(10, 10, WHITE));
    write(curr, 'new.png', makePng(10, 10, RED));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 });
    expect(s.added).toBe(1);
    expect(s.removed).toBe(1);
    expect(s.unchanged).toBe(1);
    expect(s.hasChanges).toBe(true); // removed counts
    const byName = Object.fromEntries(s.results.map((r) => [r.name, r.status]));
    expect(byName['new.png']).toBe('added');
    expect(byName['gone.png']).toBe('removed');
  });

  it('missing baseline dir means everything is added', () => {
    const { curr } = tmpDirs();
    write(curr, 'a.png', makePng(10, 10, WHITE));
    const s = compareDirectories('/nope', curr, { threshold: 0.1, diffRatio: 0 });
    expect(s.added).toBe(1);
    expect(s.hasChanges).toBe(false);
  });
});
```

- [ ] **Step 2: Run `npx vitest run tests/diff.test.ts`** — expect FAIL.

- [ ] **Step 3: Write `src/diff.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { CompareSummary, ScreenshotResult } from './types';

export function listPngs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relPath);
      else if (entry.name.toLowerCase().endsWith('.png')) out.push(relPath);
    }
  };
  walk('');
  return out.sort();
}

/** Copy `src` into the top-left of a canvas of the given dimensions. */
function onCanvas(src: PNG, width: number, height: number): PNG {
  const canvas = new PNG({ width, height });
  for (let y = 0; y < src.height; y++) {
    src.data.copy(canvas.data, (y * width) * 4, (y * src.width) * 4, (y * src.width + src.width) * 4);
  }
  return canvas;
}

function compareOne(
  name: string,
  baselineBuf: Buffer,
  currentBuf: Buffer,
  opts: { threshold: number; diffRatio: number }
): ScreenshotResult {
  let a = PNG.sync.read(baselineBuf);
  let b = PNG.sync.read(currentBuf);
  const dimsMismatch = a.width !== b.width || a.height !== b.height;
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  if (dimsMismatch) {
    a = onCanvas(a, width, height);
    b = onCanvas(b, width, height);
  }
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: opts.threshold,
  });
  const ratio = mismatched / (width * height);
  const changed = dimsMismatch || ratio > opts.diffRatio;
  return {
    name,
    status: changed ? 'changed' : 'unchanged',
    diffRatio: ratio,
    baselinePng: changed ? baselineBuf : undefined,
    currentPng: changed ? currentBuf : undefined,
    diffPng: changed ? PNG.sync.write(diff) : undefined,
  };
}

export function compareDirectories(
  baselineDir: string,
  currentDir: string,
  opts: { threshold: number; diffRatio: number }
): CompareSummary {
  const baseNames = new Set(listPngs(baselineDir));
  const currNames = new Set(listPngs(currentDir));
  const allNames = [...new Set([...baseNames, ...currNames])].sort();

  const results: ScreenshotResult[] = allNames.map((name) => {
    const inBase = baseNames.has(name);
    const inCurr = currNames.has(name);
    if (inBase && inCurr) {
      return compareOne(
        name,
        fs.readFileSync(path.join(baselineDir, name)),
        fs.readFileSync(path.join(currentDir, name)),
        opts
      );
    }
    if (inCurr) {
      return { name, status: 'added', diffRatio: 0, currentPng: fs.readFileSync(path.join(currentDir, name)) };
    }
    return { name, status: 'removed', diffRatio: 0, baselinePng: fs.readFileSync(path.join(baselineDir, name)) };
  });

  const count = (s: string): number => results.filter((r) => r.status === s).length;
  const changed = count('changed');
  const removed = count('removed');
  return {
    results,
    changed,
    added: count('added'),
    removed,
    unchanged: count('unchanged'),
    hasChanges: changed + removed > 0,
  };
}
```

- [ ] **Step 4: Run `npx vitest run tests/diff.test.ts`** — expect PASS. Run `npm run typecheck` — expect clean.

- [ ] **Step 5: Commit** — `feat: add pixelmatch diff engine with union-canvas dimension handling`

---

### Task 4: Report generation (HTML + markdown)

**Files:**
- Create: `src/report.ts`, `tests/report.test.ts`

**Interfaces:**
- Consumes: `CompareSummary`, `ScreenshotResult` from `src/types.ts`.
- Produces (`src/report.ts`):
  - `interface ReportMeta { repo: string; runUrl: string; sha: string; baselineRunUrl?: string; missingBaseline: boolean }`
  - `generateHtmlReport(summary: CompareSummary, meta: ReportMeta): string` — fully self-contained HTML, images inlined as base64 data URIs.
  - `generateMarkdownSummary(summary: CompareSummary, meta: ReportMeta): string` — used for both `$GITHUB_STEP_SUMMARY` and the PR comment body.

- [ ] **Step 1: Write the failing tests `tests/report.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { generateHtmlReport, generateMarkdownSummary, ReportMeta } from '../src/report';
import { CompareSummary } from '../src/types';

const meta: ReportMeta = {
  repo: 'Fiestaboard/demo',
  runUrl: 'https://github.com/Fiestaboard/demo/actions/runs/1',
  sha: 'abc1234',
  baselineRunUrl: 'https://github.com/Fiestaboard/demo/actions/runs/0',
  missingBaseline: false,
};

const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050201cfa102b90000000049454e44ae426082',
  'hex'
);

function summary(): CompareSummary {
  return {
    results: [
      { name: 'home.png', status: 'changed', diffRatio: 0.0123, baselinePng: png, currentPng: png, diffPng: png },
      { name: 'nav/menu.png', status: 'added', diffRatio: 0, currentPng: png },
      { name: 'old.png', status: 'removed', diffRatio: 0, baselinePng: png },
      { name: 'footer.png', status: 'unchanged', diffRatio: 0 },
    ],
    changed: 1,
    added: 1,
    removed: 1,
    unchanged: 1,
    hasChanges: true,
  };
}

describe('generateMarkdownSummary', () => {
  it('includes headline counts, changed names, and run link', () => {
    const md = generateMarkdownSummary(summary(), meta);
    expect(md).toContain('1 changed');
    expect(md).toContain('1 added');
    expect(md).toContain('1 removed');
    expect(md).toContain('home.png');
    expect(md).toContain(meta.runUrl);
    expect(md).toContain('1.23%');
  });

  it('celebrates when nothing changed', () => {
    const s: CompareSummary = { results: [], changed: 0, added: 0, removed: 0, unchanged: 3, hasChanges: false };
    const md = generateMarkdownSummary(s, meta);
    expect(md).toMatch(/no visual changes/i);
  });

  it('explains a missing baseline', () => {
    const s: CompareSummary = {
      results: [{ name: 'a.png', status: 'added', diffRatio: 0 }],
      changed: 0, added: 1, removed: 0, unchanged: 0, hasChanges: false,
    };
    const md = generateMarkdownSummary(s, { ...meta, missingBaseline: true, baselineRunUrl: undefined });
    expect(md).toMatch(/no baseline found/i);
  });
});

describe('generateHtmlReport', () => {
  it('inlines images as data URIs and lists every screenshot', () => {
    const html = generateHtmlReport(summary(), meta);
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('home.png');
    expect(html).toContain('nav/menu.png');
    expect(html).toContain('old.png');
    expect(html).toContain('footer.png');
    expect(html).not.toContain('http://'); // no external requests
    expect(html).toContain('<!doctype html>');
  });

  it('escapes HTML in screenshot names', () => {
    const s: CompareSummary = {
      results: [{ name: '<img src=x>.png', status: 'unchanged', diffRatio: 0 }],
      changed: 0, added: 0, removed: 0, unchanged: 1, hasChanges: false,
    };
    const html = generateHtmlReport(s, meta);
    expect(html).not.toContain('<img src=x>.png');
    expect(html).toContain('&lt;img src=x&gt;.png');
  });
});
```

- [ ] **Step 2: Run `npx vitest run tests/report.test.ts`** — expect FAIL.

- [ ] **Step 3: Write `src/report.ts`**

```ts
import { CompareSummary, ScreenshotResult } from './types';

export interface ReportMeta {
  repo: string;
  runUrl: string;
  sha: string;
  baselineRunUrl?: string;
  missingBaseline: boolean;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pct = (ratio: number): string => `${(ratio * 100).toFixed(2)}%`;

const dataUri = (buf?: Buffer): string =>
  buf ? `data:image/png;base64,${buf.toString('base64')}` : '';

const STATUS_LABEL: Record<string, string> = {
  changed: '🔄 Changed',
  added: '✨ Added',
  removed: '🗑️ Removed',
  unchanged: '✅ Unchanged',
};

export function generateMarkdownSummary(summary: CompareSummary, meta: ReportMeta): string {
  const lines: string[] = ['### 🎨 Visual regression report', ''];

  if (meta.missingBaseline) {
    lines.push(
      `⚠️ **No baseline found** — all ${summary.added} screenshot(s) recorded as new. ` +
        'Baselines publish on the next default-branch build.',
      ''
    );
  } else if (!summary.hasChanges && summary.added === 0) {
    lines.push(`✅ **No visual changes** across ${summary.unchanged} screenshot(s).`, '');
  } else {
    lines.push(
      `**${summary.changed} changed · ${summary.added} added · ${summary.removed} removed · ${summary.unchanged} unchanged**`,
      ''
    );
  }

  const notable = summary.results.filter((r) => r.status !== 'unchanged').slice(0, 50);
  if (notable.length > 0) {
    lines.push('| Status | Screenshot | Diff |', '|---|---|---|');
    for (const r of notable) {
      const diff = r.status === 'changed' ? pct(r.diffRatio) : '—';
      lines.push(`| ${STATUS_LABEL[r.status]} | \`${r.name}\` | ${diff} |`);
    }
    const hidden = summary.results.filter((r) => r.status !== 'unchanged').length - notable.length;
    if (hidden > 0) lines.push('', `…and ${hidden} more.`);
    lines.push('');
  }

  lines.push(`📦 [Download the full visual report](${meta.runUrl}) (run artifact \`vrt-report\`)`);
  if (meta.baselineRunUrl) lines.push('', `Baseline from [this run](${meta.baselineRunUrl}) · commit \`${meta.sha.slice(0, 7)}\``);
  return lines.join('\n');
}

function card(r: ScreenshotResult): string {
  const imgs =
    r.status === 'changed'
      ? `
    <div class="compare" style="--split:50%">
      <div class="pane"><h4>Baseline</h4><img src="${dataUri(r.baselinePng)}" alt="baseline"></div>
      <div class="pane"><h4>Current</h4><img src="${dataUri(r.currentPng)}" alt="current"></div>
      <div class="pane"><h4>Diff (${pct(r.diffRatio)})</h4><img src="${dataUri(r.diffPng)}" alt="diff"></div>
    </div>
    <div class="slider">
      <h4>Swipe</h4>
      <div class="overlay">
        <img class="under" src="${dataUri(r.baselinePng)}" alt="baseline">
        <img class="over" src="${dataUri(r.currentPng)}" alt="current">
      </div>
      <input type="range" min="0" max="100" value="50" oninput="this.closest('.card').querySelector('.over').style.clipPath = 'inset(0 ' + (100 - this.value) + '% 0 0)'">
    </div>`
      : r.status === 'added'
        ? `<div class="compare"><div class="pane"><h4>Current (new)</h4><img src="${dataUri(r.currentPng)}" alt="current"></div></div>`
        : r.status === 'removed'
          ? `<div class="compare"><div class="pane"><h4>Baseline (removed)</h4><img src="${dataUri(r.baselinePng)}" alt="baseline"></div></div>`
          : '';
  return `
  <section class="card" data-status="${r.status}">
    <header><span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span><h3>${esc(r.name)}</h3></header>
    ${imgs}
  </section>`;
}

export function generateHtmlReport(summary: CompareSummary, meta: ReportMeta): string {
  const counts = [
    ['changed', summary.changed],
    ['added', summary.added],
    ['removed', summary.removed],
    ['unchanged', summary.unchanged],
  ] as const;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual regression report — ${esc(meta.repo)}</title>
<style>
  :root { color-scheme: light dark;
    --bg:#fafafa; --fg:#1a1a1a; --card:#fff; --line:#e2e2e2; --muted:#6b6b6b;
    --changed:#b45309; --changed-bg:#fef3c7; --added:#1d4ed8; --added-bg:#dbeafe;
    --removed:#b91c1c; --removed-bg:#fee2e2; --unchanged:#15803d; --unchanged-bg:#dcfce7; }
  @media (prefers-color-scheme: dark) { :root {
    --bg:#111214; --fg:#e8e8e8; --card:#1b1d21; --line:#2e3138; --muted:#9a9a9a;
    --changed-bg:#42300a; --changed:#fbbf24; --added-bg:#172a54; --added:#93c5fd;
    --removed-bg:#450f0f; --removed:#fca5a5; --unchanged-bg:#0f3520; --unchanged:#86efac; } }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif }
  .top { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line);
    padding:16px 24px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; z-index:2 }
  .top h1 { font-size:18px; margin:0 auto 0 0 }
  .top .meta { color:var(--muted); font-size:13px; width:100% }
  button.filter { border:1px solid var(--line); background:var(--card); color:var(--fg);
    border-radius:999px; padding:4px 14px; cursor:pointer; font-size:13px }
  button.filter[aria-pressed="true"] { outline:2px solid var(--fg) }
  main { max-width:1100px; margin:0 auto; padding:24px }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:20px; margin-bottom:24px }
  .card.hidden { display:none }
  .card header { display:flex; gap:10px; align-items:center; margin-bottom:12px }
  .card h3 { margin:0; font-size:15px; font-family:ui-monospace,Menlo,monospace; word-break:break-all }
  .badge { border-radius:999px; padding:2px 10px; font-size:12px; font-weight:600; white-space:nowrap }
  .badge.changed { background:var(--changed-bg); color:var(--changed) }
  .badge.added { background:var(--added-bg); color:var(--added) }
  .badge.removed { background:var(--removed-bg); color:var(--removed) }
  .badge.unchanged { background:var(--unchanged-bg); color:var(--unchanged) }
  .compare { display:flex; gap:12px; flex-wrap:wrap }
  .pane { flex:1 1 250px; min-width:0 }
  .pane h4, .slider h4 { margin:0 0 6px; font-size:12px; color:var(--muted);
    text-transform:uppercase; letter-spacing:.05em }
  img { max-width:100%; border:1px solid var(--line); border-radius:6px; display:block;
    background:#fff }
  .slider { margin-top:16px }
  .overlay { position:relative; display:inline-block; max-width:100% }
  .overlay .over { position:absolute; inset:0; clip-path:inset(0 50% 0 0) }
  .slider input { width:100%; max-width:480px; display:block; margin-top:8px }
</style>
</head>
<body>
<div class="top">
  <h1>🎨 Visual regression report</h1>
  ${counts
    .map(
      ([k, n]) =>
        `<button class="filter" aria-pressed="true" data-status="${k}" onclick="toggle(this)">${STATUS_LABEL[k]} · ${n}</button>`
    )
    .join('\n  ')}
  <div class="meta">${esc(meta.repo)} · commit ${esc(meta.sha.slice(0, 7))} · <a href="${meta.runUrl}">workflow run</a>${
    meta.baselineRunUrl ? ` · baseline from <a href="${meta.baselineRunUrl}">this run</a>` : ''
  }${meta.missingBaseline ? ' · ⚠️ no baseline found — everything is new' : ''}</div>
</div>
<main>
${summary.results.map(card).join('\n')}
</main>
<script>
function toggle(btn) {
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(on));
  for (const card of document.querySelectorAll('.card[data-status="' + btn.dataset.status + '"]')) {
    card.classList.toggle('hidden', !on);
  }
}
</script>
</body>
</html>`;
}
```

Note: the template references `STATUS_LABEL[k]` inside the filter-button `map` — that runs in the TS template literal (build time), which is correct; only `toggle()` runs in the browser.

- [ ] **Step 4: Run `npx vitest run tests/report.test.ts`** — expect PASS. Fix escaping/typos until green; run `npm run typecheck`.

- [ ] **Step 5: Sanity-check the HTML by eye** — add a throwaway script or node -e to write `generateHtmlReport` output for a fake summary to the scratchpad and open it; verify cards, filters, and slider work. Delete the throwaway.

- [ ] **Step 6: Commit** — `feat: add self-contained HTML report and markdown summary`

---

### Task 5: Sticky PR comment

**Files:**
- Create: `src/comment.ts`, `tests/comment.test.ts`

**Interfaces:**
- Consumes: nothing internal (takes an Octokit-shaped client).
- Produces (`src/comment.ts`):
  - `const COMMENT_MARKER = '<!-- fiestaboard/visual-regression-action -->'`
  - `upsertStickyComment(octokit: MinimalOctokit, owner: string, repo: string, prNumber: number, body: string): Promise<void>` — prepends the marker, updates an existing marked comment or creates one; on any error logs a warning (via `@actions/core.warning`) and resolves without throwing (fork-PR graceful degradation).
  - `interface MinimalOctokit { rest: { issues: { listComments: Function; createComment: Function; updateComment: Function } } }` (typed loosely; tests pass a hand-rolled mock).

- [ ] **Step 1: Write the failing tests `tests/comment.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { upsertStickyComment, COMMENT_MARKER } from '../src/comment';

function mockOctokit(existing: Array<{ id: number; body?: string }>) {
  return {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: existing }),
        createComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
      },
    },
  };
}

describe('upsertStickyComment', () => {
  it('creates a marked comment when none exists', async () => {
    const ok = mockOctokit([{ id: 1, body: 'unrelated' }]);
    await upsertStickyComment(ok as never, 'o', 'r', 5, 'hello');
    expect(ok.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'o', repo: 'r', issue_number: 5, body: expect.stringContaining(COMMENT_MARKER) })
    );
    expect(ok.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it('updates the existing marked comment', async () => {
    const ok = mockOctokit([{ id: 9, body: `${COMMENT_MARKER}\nold` }]);
    await upsertStickyComment(ok as never, 'o', 'r', 5, 'new');
    expect(ok.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 9, body: expect.stringContaining('new') })
    );
    expect(ok.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('swallows errors (fork PRs) with a warning instead of throwing', async () => {
    const ok = mockOctokit([]);
    ok.rest.issues.createComment.mockRejectedValue(new Error('Resource not accessible by integration'));
    await expect(upsertStickyComment(ok as never, 'o', 'r', 5, 'x')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run `npx vitest run tests/comment.test.ts`** — expect FAIL.

- [ ] **Step 3: Write `src/comment.ts`**

```ts
import * as core from '@actions/core';

export const COMMENT_MARKER = '<!-- fiestaboard/visual-regression-action -->';

interface MinimalOctokit {
  rest: {
    issues: {
      listComments: (p: { owner: string; repo: string; issue_number: number; per_page: number }) => Promise<{ data: Array<{ id: number; body?: string }> }>;
      createComment: (p: { owner: string; repo: string; issue_number: number; body: string }) => Promise<unknown>;
      updateComment: (p: { owner: string; repo: string; comment_id: number; body: string }) => Promise<unknown>;
    };
  };
}

export async function upsertStickyComment(
  octokit: MinimalOctokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const full = `${COMMENT_MARKER}\n${body}`;
  try {
    const { data } = await octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100 });
    const existing = data.find((c) => c.body?.includes(COMMENT_MARKER));
    if (existing) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: full });
    } else {
      await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: full });
    }
  } catch (err) {
    core.warning(`Could not post PR comment (fork PR or missing pull-requests: write permission): ${err}`);
  }
}
```

- [ ] **Step 4: Run `npx vitest run tests/comment.test.ts`** — expect PASS.

- [ ] **Step 5: Commit** — `feat: add sticky PR comment with graceful fork degradation`

---

### Task 6: Baseline artifact find/download/upload

**Files:**
- Create: `src/baseline.ts`, `tests/baseline.test.ts`

**Interfaces:**
- Consumes: `listPngs(dir)` from `src/diff.ts`.
- Produces (`src/baseline.ts`):
  - `baselineArtifactName(key: string): string` → `'vrt-baseline'` or `` `vrt-baseline-${key}` ``
  - `reportArtifactName(key: string): string` → same pattern with `vrt-report`
  - `interface BaselineRef { artifactId: number; runId: number; runUrl: string }`
  - `findBaselineArtifact(octokit, owner: string, repo: string, name: string, branch: string): Promise<BaselineRef | null>` — newest non-expired artifact with that exact name whose `workflow_run.head_branch === branch`.
  - `downloadBaselineArtifact(ref: BaselineRef, owner: string, repo: string, token: string, destDir: string): Promise<void>` — via `@actions/artifact` `downloadArtifact` with `findBy`.
  - `uploadDirectoryAsArtifact(name: string, dir: string, retentionDays?: number): Promise<void>` — uploads every file under `dir` (rooted at `dir`).
  - `uploadFileAsArtifact(name: string, filePath: string, retentionDays?: number): Promise<void>` — uploads one file rooted at its dirname.

- [ ] **Step 1: Write the failing tests `tests/baseline.test.ts`** (pure logic + find; upload/download are thin SDK wrappers exercised by the e2e job in Task 8):

```ts
import { describe, it, expect, vi } from 'vitest';
import { baselineArtifactName, reportArtifactName, findBaselineArtifact } from '../src/baseline';

describe('artifact names', () => {
  it('suffixes only when a key is given', () => {
    expect(baselineArtifactName('')).toBe('vrt-baseline');
    expect(baselineArtifactName('web')).toBe('vrt-baseline-web');
    expect(reportArtifactName('')).toBe('vrt-report');
    expect(reportArtifactName('web')).toBe('vrt-report-web');
  });
});

function mockOctokit(artifacts: unknown[]) {
  return {
    rest: {
      actions: {
        listArtifactsForRepo: vi.fn().mockResolvedValue({ data: { artifacts } }),
      },
    },
  } as never;
}

const art = (over: Record<string, unknown>) => ({
  id: 1,
  name: 'vrt-baseline',
  expired: false,
  created_at: '2026-09-01T00:00:00Z',
  workflow_run: { id: 100, head_branch: 'main' },
  ...over,
});

describe('findBaselineArtifact', () => {
  it('returns the newest matching artifact on the branch', async () => {
    const ok = mockOctokit([
      art({ id: 2, created_at: '2026-09-02T00:00:00Z', workflow_run: { id: 200, head_branch: 'main' } }),
      art({ id: 1, created_at: '2026-09-01T00:00:00Z' }),
    ]);
    const ref = await findBaselineArtifact(ok, 'o', 'r', 'vrt-baseline', 'main');
    expect(ref).toEqual({ artifactId: 2, runId: 200, runUrl: 'https://github.com/o/r/actions/runs/200' });
  });

  it('skips expired artifacts and other branches', async () => {
    const ok = mockOctokit([
      art({ id: 3, expired: true }),
      art({ id: 4, workflow_run: { id: 400, head_branch: 'other' } }),
    ]);
    expect(await findBaselineArtifact(ok, 'o', 'r', 'vrt-baseline', 'main')).toBeNull();
  });

  it('returns null when nothing matches', async () => {
    expect(await findBaselineArtifact(mockOctokit([]), 'o', 'r', 'vrt-baseline', 'main')).toBeNull();
  });
});
```

- [ ] **Step 2: Run `npx vitest run tests/baseline.test.ts`** — expect FAIL.

- [ ] **Step 3: Write `src/baseline.ts`**

```ts
import * as path from 'path';
import { DefaultArtifactClient } from '@actions/artifact';
import { listPngs } from './diff';

export function baselineArtifactName(key: string): string {
  return key ? `vrt-baseline-${key}` : 'vrt-baseline';
}

export function reportArtifactName(key: string): string {
  return key ? `vrt-report-${key}` : 'vrt-report';
}

export interface BaselineRef {
  artifactId: number;
  runId: number;
  runUrl: string;
}

interface ArtifactListItem {
  id: number;
  name: string;
  expired: boolean;
  created_at: string | null;
  workflow_run?: { id?: number; head_branch?: string } | null;
}

interface ArtifactOctokit {
  rest: {
    actions: {
      listArtifactsForRepo: (p: {
        owner: string;
        repo: string;
        name: string;
        per_page: number;
      }) => Promise<{ data: { artifacts: ArtifactListItem[] } }>;
    };
  };
}

export async function findBaselineArtifact(
  octokit: ArtifactOctokit,
  owner: string,
  repo: string,
  name: string,
  branch: string
): Promise<BaselineRef | null> {
  const { data } = await octokit.rest.actions.listArtifactsForRepo({ owner, repo, name, per_page: 100 });
  const match = data.artifacts
    .filter((a) => a.name === name && !a.expired && a.workflow_run?.head_branch === branch && a.workflow_run?.id)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
  if (!match) return null;
  const runId = match.workflow_run!.id!;
  return { artifactId: match.id, runId, runUrl: `https://github.com/${owner}/${repo}/actions/runs/${runId}` };
}

export async function downloadBaselineArtifact(
  ref: BaselineRef,
  owner: string,
  repo: string,
  token: string,
  destDir: string
): Promise<void> {
  const client = new DefaultArtifactClient();
  await client.downloadArtifact(ref.artifactId, {
    path: destDir,
    findBy: { token, workflowRunId: ref.runId, repositoryOwner: owner, repositoryName: repo },
  });
}

export async function uploadDirectoryAsArtifact(name: string, dir: string, retentionDays?: number): Promise<void> {
  const client = new DefaultArtifactClient();
  const files = listPngs(dir).map((rel) => path.join(dir, rel));
  if (files.length === 0) throw new Error(`No .png files found in "${dir}" — nothing to upload.`);
  await client.uploadArtifact(name, files, dir, retentionDays ? { retentionDays } : {});
}

export async function uploadFileAsArtifact(name: string, filePath: string, retentionDays?: number): Promise<void> {
  const client = new DefaultArtifactClient();
  await client.uploadArtifact(name, [filePath], path.dirname(filePath), retentionDays ? { retentionDays } : {});
}
```

- [ ] **Step 4: Run `npx vitest run tests/baseline.test.ts`** — expect PASS. Run `npm run typecheck`.

- [ ] **Step 5: Commit** — `feat: add baseline artifact lookup, download, and upload`

---

### Task 7: Orchestration (`main.ts`), `action.yml`, and the committed bundle

**Files:**
- Create: `src/main.ts`, `action.yml`
- Create (generated): `dist/`

**Interfaces:**
- Consumes: everything from Tasks 2–6 — `resolveMode(modeInput, eventName, ref, defaultBranch)`; `compareDirectories(baselineDir, currentDir, {threshold, diffRatio})`; `generateHtmlReport(summary, meta)` / `generateMarkdownSummary(summary, meta)` / `ReportMeta`; `upsertStickyComment(octokit, owner, repo, prNumber, body)`; `baselineArtifactName(key)` / `reportArtifactName(key)` / `findBaselineArtifact(...)` / `downloadBaselineArtifact(...)` / `uploadDirectoryAsArtifact(...)` / `uploadFileAsArtifact(...)`.
- Produces: runnable action (`dist/index.js`), the public `action.yml` contract.

- [ ] **Step 1: Write `action.yml`**

```yaml
name: 'Visual Regression Action'
description: >-
  Visual regression testing with artifact-based baselines: diff PR screenshots
  against the default branch's build artifacts and get an HTML report + sticky
  PR comment. No screenshots committed to git.
author: 'Fiestaboard'
branding:
  icon: 'eye'
  color: 'purple'

inputs:
  screenshots-dir:
    description: 'Directory containing the captured PNG screenshots'
    required: true
  github-token:
    description: 'Token used to look up/download baseline artifacts and post the PR comment'
    default: ${{ github.token }}
  mode:
    description: 'auto | baseline | compare. auto = pull requests compare, pushes to the default branch publish baselines'
    default: 'auto'
  key:
    description: 'Optional suffix for artifact names — use for matrix builds or multiple apps in one repo'
    default: ''
  threshold:
    description: 'Per-pixel color sensitivity passed to pixelmatch (0-1, smaller = more sensitive)'
    default: '0.1'
  diff-ratio:
    description: 'Fraction of differing pixels (0-1) above which an image counts as changed'
    default: '0'
  fail-on-diff:
    description: 'Fail the job when screenshots changed or were removed'
    default: 'true'
  comment:
    description: 'Post/update a sticky PR comment with the results'
    default: 'true'
  baseline-branch:
    description: 'Branch whose baseline artifact to compare against. Defaults to the PR base branch (or the default branch)'
    default: ''
  retention-days:
    description: 'Artifact retention override in days (empty = repo default)'
    default: ''

outputs:
  changed:
    description: 'Number of changed screenshots'
  added:
    description: 'Number of added screenshots'
  removed:
    description: 'Number of removed screenshots'
  unchanged:
    description: 'Number of unchanged screenshots'
  has-changes:
    description: 'true when changed + removed > 0'
  report-path:
    description: 'Local path of the generated HTML report'

runs:
  using: 'node20'
  main: 'dist/index.js'
```

- [ ] **Step 2: Write `src/main.ts`**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { resolveMode } from './mode';
import { compareDirectories } from './diff';
import { generateHtmlReport, generateMarkdownSummary, ReportMeta } from './report';
import { upsertStickyComment } from './comment';
import {
  baselineArtifactName,
  reportArtifactName,
  findBaselineArtifact,
  downloadBaselineArtifact,
  uploadDirectoryAsArtifact,
  uploadFileAsArtifact,
} from './baseline';
import { CompareSummary } from './types';

async function run(): Promise<void> {
  const screenshotsDir = core.getInput('screenshots-dir', { required: true });
  const token = core.getInput('github-token', { required: true });
  const key = core.getInput('key');
  const threshold = parseFloat(core.getInput('threshold') || '0.1');
  const diffRatio = parseFloat(core.getInput('diff-ratio') || '0');
  const failOnDiff = core.getBooleanInput('fail-on-diff');
  const comment = core.getBooleanInput('comment');
  const retentionInput = core.getInput('retention-days');
  const retentionDays = retentionInput ? parseInt(retentionInput, 10) : undefined;

  const ctx = github.context;
  const { owner, repo } = ctx.repo;
  const defaultBranch: string = ctx.payload.repository?.default_branch ?? 'main';
  const mode = resolveMode(core.getInput('mode') || 'auto', ctx.eventName, ctx.ref, defaultBranch);
  core.info(`Mode: ${mode}`);

  if (!fs.existsSync(screenshotsDir)) {
    throw new Error(`screenshots-dir "${screenshotsDir}" does not exist.`);
  }

  if (mode === 'baseline') {
    await uploadDirectoryAsArtifact(baselineArtifactName(key), screenshotsDir, retentionDays);
    core.info(`Published baseline artifact "${baselineArtifactName(key)}" from ${screenshotsDir}`);
    return;
  }

  // --- compare mode ---
  const baselineBranch =
    core.getInput('baseline-branch') || ctx.payload.pull_request?.base?.ref || defaultBranch;
  const octokit = github.getOctokit(token);
  const artifactName = baselineArtifactName(key);
  const ref = await findBaselineArtifact(octokit, owner, repo, artifactName, baselineBranch);

  let baselineDir = '';
  if (ref) {
    baselineDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'vrt-baseline-'));
    await downloadBaselineArtifact(ref, owner, repo, token, baselineDir);
    core.info(`Baseline "${artifactName}" from run ${ref.runId} (branch ${baselineBranch})`);
  } else {
    core.warning(
      `No baseline artifact "${artifactName}" found on branch "${baselineBranch}" — ` +
        'all screenshots will be recorded as new. Baselines publish on the next default-branch build.'
    );
  }

  const summary: CompareSummary = compareDirectories(baselineDir || '/nonexistent-baseline', screenshotsDir, {
    threshold,
    diffRatio,
  });

  const meta: ReportMeta = {
    repo: `${owner}/${repo}`,
    runUrl: `https://github.com/${owner}/${repo}/actions/runs/${ctx.runId}`,
    sha: ctx.payload.pull_request?.head?.sha ?? ctx.sha,
    baselineRunUrl: ref?.runUrl,
    missingBaseline: !ref,
  };

  const reportDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'vrt-report-'));
  const reportPath = path.join(reportDir, 'index.html');
  fs.writeFileSync(reportPath, generateHtmlReport(summary, meta));
  await uploadFileAsArtifact(reportArtifactName(key), reportPath, retentionDays);

  const md = generateMarkdownSummary(summary, meta);
  await core.summary.addRaw(md).write();

  const prNumber = ctx.payload.pull_request?.number;
  if (comment && prNumber) {
    await upsertStickyComment(octokit, owner, repo, prNumber, md);
  }

  core.setOutput('changed', String(summary.changed));
  core.setOutput('added', String(summary.added));
  core.setOutput('removed', String(summary.removed));
  core.setOutput('unchanged', String(summary.unchanged));
  core.setOutput('has-changes', String(summary.hasChanges));
  core.setOutput('report-path', reportPath);

  core.info(
    `Compared ${summary.results.length} screenshot(s): ` +
      `${summary.changed} changed, ${summary.added} added, ${summary.removed} removed, ${summary.unchanged} unchanged.`
  );

  if (failOnDiff && summary.hasChanges) {
    core.setFailed(
      `Visual changes detected: ${summary.changed} changed, ${summary.removed} removed. ` +
        `Download the "${reportArtifactName(key)}" artifact to review. Merging this PR updates the baselines.`
    );
  }
}

run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
```

Note for baseline mode outputs: baseline mode intentionally sets no outputs; document this in the README.

- [ ] **Step 3: Run full checks** — `npm run typecheck && npm test` — expect all green.

- [ ] **Step 4: Build the bundle** — `npm run build`; confirm `dist/index.js` exists and starts with a CJS wrapper. Then run a smoke test locally:

```bash
GITHUB_REPOSITORY=fake/fake INPUT_SCREENSHOTS-DIR=/nonexistent node dist/index.js; echo "exit=$?"
```

Expected: prints an error about mode/screenshots-dir (context is empty locally) and exits non-zero via `setFailed` — proves the bundle loads and runs without module errors.

- [ ] **Step 5: Commit (including `dist/` and `licenses.txt`)** — `feat: add action entrypoint, action.yml, and ncc bundle`

---

### Task 8: CI + dogfood e2e workflow

**Files:**
- Create: `.github/workflows/ci.yml`, `scripts/make-e2e-fixtures.mjs`

**Interfaces:**
- Consumes: the committed action at repo root (`uses: ./`), its inputs/outputs from Task 7.
- Produces: green CI proving unit tests, dist freshness, and a real end-to-end baseline→compare cycle on GitHub's runners.

- [ ] **Step 1: Write `scripts/make-e2e-fixtures.mjs`**

```js
// Generates PNG fixture directories for the e2e dogfood job.
// base/:    same.png, changed.png, removed.png
// changed/: same.png, changed.png (differs), added.png
// Expected compare result: 1 changed, 1 added, 1 removed, 1 unchanged.
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

function png(width, height, [r, g, b, a], rect) {
  const img = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
  }
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = (y * width + x) * 4;
        img.data[i] = rect.color[0]; img.data[i + 1] = rect.color[1];
        img.data[i + 2] = rect.color[2]; img.data[i + 3] = rect.color[3];
      }
    }
  }
  return PNG.sync.write(img);
}

const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];
const base = 'e2e-tmp/base';
const changed = 'e2e-tmp/changed';
mkdirSync(base, { recursive: true });
mkdirSync(changed, { recursive: true });

writeFileSync(join(base, 'same.png'), png(100, 100, WHITE));
writeFileSync(join(changed, 'same.png'), png(100, 100, WHITE));
writeFileSync(join(base, 'changed.png'), png(100, 100, WHITE));
writeFileSync(join(changed, 'changed.png'), png(100, 100, WHITE, { x: 10, y: 10, w: 30, h: 30, color: RED }));
writeFileSync(join(base, 'removed.png'), png(100, 100, WHITE));
writeFileSync(join(changed, 'added.png'), png(100, 100, RED));
console.log('e2e fixtures written to e2e-tmp/');
```

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - name: Verify dist is up to date
        run: |
          if ! git diff --quiet dist/; then
            echo "::error::dist/ is stale. Run 'npm run build' and commit the result."
            git diff --stat dist/
            exit 1
          fi

  e2e:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Generate fixtures
        run: node scripts/make-e2e-fixtures.mjs

      - name: Publish baseline (dogfood)
        uses: ./
        with:
          mode: baseline
          screenshots-dir: e2e-tmp/base
          key: e2e-${{ github.run_id }}
          retention-days: 1

      - name: Compare against baseline (dogfood)
        id: compare
        uses: ./
        with:
          mode: compare
          screenshots-dir: e2e-tmp/changed
          key: e2e-${{ github.run_id }}
          baseline-branch: ${{ github.head_ref || github.ref_name }}
          fail-on-diff: false
          comment: false
          retention-days: 1

      - name: Assert outputs
        env:
          CHANGED: ${{ steps.compare.outputs.changed }}
          ADDED: ${{ steps.compare.outputs.added }}
          REMOVED: ${{ steps.compare.outputs.removed }}
          UNCHANGED: ${{ steps.compare.outputs.unchanged }}
          HAS_CHANGES: ${{ steps.compare.outputs.has-changes }}
        run: |
          set -euo pipefail
          fail() { echo "::error::$1"; exit 1; }
          [ "$CHANGED" = "1" ] || fail "expected changed=1, got '$CHANGED'"
          [ "$ADDED" = "1" ] || fail "expected added=1, got '$ADDED'"
          [ "$REMOVED" = "1" ] || fail "expected removed=1, got '$REMOVED'"
          [ "$UNCHANGED" = "1" ] || fail "expected unchanged=1, got '$UNCHANGED'"
          [ "$HAS_CHANGES" = "true" ] || fail "expected has-changes=true, got '$HAS_CHANGES'"
          echo "e2e assertions passed ✅"
```

Why `key: e2e-${{ github.run_id }}`: makes each run's baseline artifact unique, so the compare step deterministically finds *this run's* baseline (v4 artifacts are listable/downloadable while the run is still in progress) and parallel runs never cross-contaminate. Why `baseline-branch: ${{ github.head_ref || github.ref_name }}`: on `pull_request` events the artifact's `workflow_run.head_branch` is the PR head branch, not the base.

- [ ] **Step 3: Sanity-check locally with act if practical** — `act -l` then `act push -j check` (the `check` job only; the `e2e` job needs real GitHub artifact APIs and cannot pass under act — expected, don't chase it). If the act image lacks something unrelated to our code, note it and move on; the authoritative run happens on GitHub in Task 10.

- [ ] **Step 4: Commit** — `ci: add check and dogfood e2e workflows`

---

### Task 9: README + example workflows

**Files:**
- Create: `README.md`, `examples/playwright.yml`, `examples/storybook.yml`, `LICENSE`

**Interfaces:**
- Consumes: the `action.yml` contract from Task 7 (inputs/outputs/permissions must match it exactly).

- [ ] **Step 1: Write `LICENSE`** — standard MIT text, copyright `2026 Fiestaboard`.

- [ ] **Step 2: Write `README.md`** with these sections (prose to be written for real, not placeholders — the structure below is the required outline and the code blocks must appear verbatim):

1. **Title + one-liner:** "Visual regression testing for GitHub Actions — baselines live in build artifacts, not your git history."
2. **How it works** (3 bullets + the flow): pushes to your default branch publish a `vrt-baseline` artifact; PRs download the latest baseline from the base branch, diff, and report; **merging the PR is the approval** — main rebuilds and publishes new baselines. No screenshots in git, no "update baselines" ritual. Expired/missing baselines (artifacts expire after ≤90 days) mean everything reports as new and the next main build self-heals.
3. **Quick start** — the minimal workflow:

```yaml
name: Visual tests
on:
  push:
    branches: [main]
  pull_request:

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

4. **Inputs** and **Outputs** tables — copy exactly from `action.yml` (names, defaults, descriptions), plus a note that baseline mode sets no outputs.
5. **The report** — describe the three surfaces (sticky PR comment, step summary, downloadable `vrt-report` artifact with side-by-side + swipe slider). 
6. **Recipes:** matrix/multi-app via `key`; report-only mode (`fail-on-diff: false` + branching on `has-changes`); comparing against a non-default branch via `baseline-branch`; monorepos (two invocations with different `key` and `screenshots-dir`).
7. **Fork PRs & permissions** — what degrades and why.
8. **FAQ** — "Why is my check red after an intentional change?" (that's the design: merge = approval; or run report-only), "What happens on the very first run?" (no baseline → everything new → passes), "Do artifacts cost money?" (they count toward storage quota; use `retention-days` to trim).

- [ ] **Step 3: Write `examples/playwright.yml`** — full workflow: checkout, setup-node, `npm ci`, `npx playwright install --with-deps chromium`, run a Playwright script that saves `page.screenshot({ path: 'screenshots/<name>.png' })` per page, then the action. Include the `permissions` block from the quick start.

- [ ] **Step 4: Write `examples/storybook.yml`** — full workflow: checkout, setup-node, `npm ci`, `npm run build-storybook`, capture with `npx playwright screenshot` or a loop over stories via a small node script hitting `http-server storybook-static`, then the action. Keep it honest: mark the capture section clearly as "replace with your capture tool" since capture is out of scope.

- [ ] **Step 5: Commit** — `docs: add README, license, and example workflows`

---

### Task 10: Create the GitHub repo, verify CI end-to-end, release v1

**Files:**
- No new source files; operates on the repo.

**Interfaces:**
- Consumes: everything; the whole repo must be green on GitHub's runners before tagging.

- [ ] **Step 1: Create the repo and push**

```bash
gh repo create Fiestaboard/visual-regression-action --public \
  --description "Visual regression testing for GitHub Actions — artifact-based baselines, HTML diff reports, no screenshots in git" \
  --source . --push
```

- [ ] **Step 2: Watch CI** — `gh run watch --repo Fiestaboard/visual-regression-action --exit-status` (get the run id from `gh run list` first). Both `check` and `e2e` jobs must pass. If `e2e` fails, debug with the run logs (`gh run view <id> --log-failed`) — likely suspects: artifact listing timing, `baseline-branch` resolution, or missing `actions: read` permission. Fix, rebuild dist if src changed, push, repeat until green.

- [ ] **Step 3: Verify the report artifact by hand** — download `vrt-report-e2e-<run_id>` from the e2e run (`gh run download <id> --repo ... -n vrt-report-e2e-<run_id>`), open `index.html` locally, confirm: 4 cards, correct badges, images render, swipe slider works, filter buttons hide/show cards.

- [ ] **Step 4: Tag and release**

```bash
git tag -a v1.0.0 -m "v1.0.0 — initial release"
git tag -f v1
git push origin v1.0.0 v1
gh release create v1.0.0 --repo Fiestaboard/visual-regression-action \
  --title "v1.0.0" --generate-notes
```

- [ ] **Step 5: Smoke the published tag** — confirm `gh api repos/Fiestaboard/visual-regression-action/git/ref/tags/v1` resolves. Note in the final report that Marketplace listing (optional) is a manual step: repo → Releases → "Publish this Action to the GitHub Marketplace".

- [ ] **Step 6: Commit any final tweaks** — `chore: release v1.0.0`

---

## Self-Review Notes

- **Spec coverage:** modes/auto-detect (T2, T7), diff engine + buckets + thresholds + union canvas (T3), three report surfaces (T4, T7), sticky comment + fork degradation (T5), artifact storage/lookup incl. expiry → null → "all new, pass with note" (T6, T7), pass/fail semantics (T7), permissions + README + examples (T9), dogfood e2e + dist check (T8), release v1/v1.0.0 (T10). `retention-days` and `baseline-branch` inputs covered in T7/T8.
- **Type consistency:** `CompareSummary`/`ScreenshotResult` defined once in T2 and consumed by T3/T4/T7; `ReportMeta` defined in T4, consumed in T7; `BaselineRef` defined in T6, consumed in T7. Function names cross-checked between Interfaces blocks and code.
- **Known judgment calls baked in:** `has-changes` = changed+removed only (added never fails); baseline mode sets no outputs; e2e uses run-unique `key` and explicit `baseline-branch` because artifact `head_branch` on PR events is the head branch.
