import { describe, it, expect } from 'vitest';
import { generateHtmlReport, generateMarkdownSummary, ReportMeta } from '../src/report';
import { CompareSummary } from '../src/types';

const meta: ReportMeta = {
  repo: 'Fiestaboard/demo',
  runUrl: 'https://github.com/Fiestaboard/demo/actions/runs/1',
  sha: 'abc1234',
  baselineRunUrl: 'https://github.com/Fiestaboard/demo/actions/runs/0',
  missingBaseline: false,
  reportArtifactName: 'vrt-report',
};

const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050201cfa102b90000000049454e44ae426082',
  'hex'
);
// Distinct payload so mask embeds are countable separately from the shared fixture PNG.
const maskPng = Buffer.from('not-a-real-png-but-a-distinct-mask-payload');

function summary(): CompareSummary {
  return {
    // Deliberately not in review order: the HTML must sort changed → added → removed → unchanged.
    results: [
      { name: 'footer.png', status: 'unchanged', diffRatio: 0 },
      { name: 'old.png', status: 'removed', diffRatio: 0, baselinePng: png },
      { name: 'nav/menu.png', status: 'added', diffRatio: 0, currentPng: png },
      { name: 'home.png', status: 'changed', diffRatio: 0.0123, baselinePng: png, currentPng: png, diffPng: png, diffMaskPng: maskPng },
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

  it('uses the direct artifact download URL when available', () => {
    const md = generateMarkdownSummary(summary(), {
      ...meta,
      reportDownloadUrl: 'https://github.com/Fiestaboard/demo/actions/runs/1/artifacts/42',
    });
    expect(md).toContain('[Download the full visual report](https://github.com/Fiestaboard/demo/actions/runs/1/artifacts/42)');
    expect(md).toContain('[workflow run](https://github.com/Fiestaboard/demo/actions/runs/1)');
  });

  it('falls back to the run URL when no download URL exists', () => {
    const md = generateMarkdownSummary(summary(), meta);
    expect(md).toContain('[Download the full visual report](https://github.com/Fiestaboard/demo/actions/runs/1)');
  });

  it('interpolates the key-aware report artifact name', () => {
    const md = generateMarkdownSummary(summary(), { ...meta, reportArtifactName: 'vrt-report-web' });
    expect(md).toContain('vrt-report-web');
    expect(md).not.toContain('artifact `vrt-report`');
  });

  it('escapes pipe characters in screenshot names so they cannot break the table', () => {
    const s: CompareSummary = {
      results: [{ name: 'a|b.png', status: 'changed', diffRatio: 0.01, baselinePng: png, currentPng: png, diffPng: png, diffMaskPng: maskPng }],
      changed: 1, added: 0, removed: 0, unchanged: 0, hasChanges: true,
    };
    const md = generateMarkdownSummary(s, meta);
    expect(md).toContain('a\\|b.png');
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

  it('orders cards changed → added → removed → unchanged regardless of input order', () => {
    const html = generateHtmlReport(summary(), meta);
    const pos = (name: string) => html.indexOf(`<h3>${name}</h3>`);
    expect(pos('home.png')).toBeGreaterThan(-1);
    expect(pos('home.png')).toBeLessThan(pos('nav/menu.png'));
    expect(pos('nav/menu.png')).toBeLessThan(pos('old.png'));
    expect(pos('old.png')).toBeLessThan(pos('footer.png'));
  });

  it('embeds each PNG exactly once and the mask exactly once', () => {
    const html = generateHtmlReport(summary(), meta);
    const payload = png.toString('base64');
    // home.png (changed): baseline+current+diff in the side-by-side view = 3.
    // nav/menu.png (added) and old.png (removed): one each = 5 total.
    // Swipe/overlay/reviewer views reuse those srcs at runtime — no re-embeds.
    expect(html.split(payload).length - 1).toBe(5);
    expect(html.split(maskPng.toString('base64')).length - 1).toBe(1);
    // Runtime-populated images ship without src attributes.
    expect(html).toContain('<img class="sw-under" alt="current">');
    expect(html).toContain('<img class="sw-over" alt="baseline">');
    expect(html).toContain('<img class="ov-cur" alt="current">');
  });

  it('renders the comparison stage modes and the fullscreen reviewer', () => {
    const html = generateHtmlReport(summary(), meta);
    expect(html).toContain('data-mode="swipe"');
    expect(html).toContain('data-mode="overlay"');
    expect(html).toContain('data-mode="sbs"');
    expect(html).toContain('class="lightbox"');
    expect(html).toContain('ArrowRight');
    expect(html).toContain('Review 3 changes');
  });

  it('reviewer has visible prev/next buttons, kbd hints, and selection disabled on drag surfaces', () => {
    const html = generateHtmlReport(summary(), meta);
    expect(html).toContain('class="lb-nav prev"');
    expect(html).toContain('class="lb-nav next"');
    expect(html).toContain('Swipe <kbd>S</kbd>');
    expect(html).toContain('Close <kbd>Esc</kbd>');
    expect(html).toContain('user-select:none');
    expect(html).toContain('dragstart');
  });

  it('omits the review button when nothing is reviewable', () => {
    const s: CompareSummary = {
      results: [{ name: 'a.png', status: 'unchanged', diffRatio: 0 }],
      changed: 0, added: 0, removed: 0, unchanged: 1, hasChanges: false,
    };
    const html = generateHtmlReport(s, meta);
    expect(html).not.toContain('class="review"');
  });
});
