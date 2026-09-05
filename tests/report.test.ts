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

  it('interpolates the key-aware report artifact name', () => {
    const md = generateMarkdownSummary(summary(), { ...meta, reportArtifactName: 'vrt-report-web' });
    expect(md).toContain('vrt-report-web');
    expect(md).not.toContain('artifact `vrt-report`');
  });

  it('escapes pipe characters in screenshot names so they cannot break the table', () => {
    const s: CompareSummary = {
      results: [{ name: 'a|b.png', status: 'changed', diffRatio: 0.01, baselinePng: png, currentPng: png, diffPng: png }],
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

  it('embeds each PNG for a changed screenshot exactly once (swipe overlay reuses pane images)', () => {
    const html = generateHtmlReport(summary(), meta);
    const payload = png.toString('base64');
    const occurrences = html.split(payload).length - 1;
    // home.png (changed) has baseline+current+diff all equal to the same fixture PNG,
    // so its 3 panes each embed it once = 3. old.png (removed) and nav/menu.png (added)
    // each embed it once more = 5 total. The overlay must NOT add a 4th/5th/6th copy.
    expect(occurrences).toBe(5);
    // The overlay images should have no src in the markup (populated by script at runtime).
    expect(html).toContain('<img class="under" alt="baseline">');
    expect(html).toContain('<img class="over" alt="current">');
  });
});
