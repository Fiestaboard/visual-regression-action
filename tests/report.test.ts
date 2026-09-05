import { describe, it, expect } from 'vitest';
import { generateHtmlReport, generateMarkdownSummary, approvalOutcomeBody, ReportMeta } from '../src/report';
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

  it('calls out partial approval with the names still needing review', () => {
    const s = summary();
    s.results[3].approved = true; // home.png approved; old.png (removed) is not
    const md = generateMarkdownSummary(s, meta);
    expect(md).toContain('⚠️');
    expect(md).toMatch(/1 of 2 .*approved/i);
    expect(md).toContain('still needing review');
    expect(md).toContain('`old.png`');
    expect(md).not.toContain('still needing review: `home.png`');
  });

  it('embeds ready-to-copy approve commands when unapproved changes exist', () => {
    const md = generateMarkdownSummary(summary(), meta);
    expect(md).toContain('/vrt approve all');
    expect(md).toContain('all@abc1234');
    expect(md).toContain('home.png@abc1234');
    expect(md).toContain('old.png@abc1234');
    expect(md).toContain('Next steps');
    expect(md).toContain('- [ ] <!-- vrt:approve-all@abc1234 -->');
    expect(md).toContain('open `index.html`');
    expect(md).toContain('Download the visual report');
  });

  it('omits the approve-command block when everything is approved', () => {
    const s = summary();
    for (const r of s.results) if (r.status === 'changed' || r.status === 'removed') r.approved = true;
    const md = generateMarkdownSummary(s, meta);
    expect(md).not.toContain('Next steps');
    expect(md).not.toContain('/vrt approve all@');
  });

  it('omits the approve-command block when the baseline is missing', () => {
    const md = generateMarkdownSummary(summary(), { ...meta, missingBaseline: true });
    expect(md).not.toContain('Next steps');
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

describe('approvalOutcomeBody', () => {

  it('celebrates full approval with a pass message', () => {
    const s = summary();
    for (const r of s.results) if (r.status === 'changed' || r.status === 'removed') r.approved = true;
    const body = approvalOutcomeBody(s, meta);
    expect(body).toContain('### Approvals applied');
    expect(body).toContain('✅');
    expect(body).toContain('passed');
  });

  it('reports partial approval with the missing names', () => {
    const s = summary();
    s.results[3].approved = true; // home.png only
    const body = approvalOutcomeBody(s, meta);
    expect(body).toContain('### Approvals partially applied');
    expect(body).toContain('⚠️');
    expect(body).toContain('`old.png`');
  });

  it('explains when nothing matched', () => {
    const body = approvalOutcomeBody(summary(), meta);
    expect(body).toContain('### No approvals matched');
    expect(body).toContain('❌');
    expect(body).toContain('stale');
  });

  it('reports a clean pass when nothing needed approval', () => {
    const s: CompareSummary = { results: [], changed: 0, added: 0, removed: 0, unchanged: 3, hasChanges: false };
    expect(approvalOutcomeBody(s, meta)).toContain('### Check passed');
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
    expect(html).toContain('Start review');
    expect(html).toContain('data-mode="blink"');
    expect(html).toContain('lb-dots');
    expect(html).toContain('localStorage');
    expect(html).toContain('issue-comment-box');
  });

  it('command bar guides the reviewer through all states', () => {
    const html = generateHtmlReport(summary(), meta);
    expect(html).toContain('class="coverage"');
    expect(html).toContain('updateCmdbar');
    expect(html).toContain('assembles here'); // pre-review guidance
    expect(html).toContain('still unreviewed'); // partial state
    expect(html).toContain('post as a PR comment and the check will pass'); // complete state
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

  it('stamps approvable cards with commit pins and ships the approval command bar', () => {
    const html = generateHtmlReport(summary(), { ...meta, prUrl: 'https://github.com/Fiestaboard/demo/pull/7' });
    expect(html).toContain('data-pin="abc1234"'); // changed + removed cards pin the head commit
    expect(html).toContain('class="cmdbar"');
    expect(html).toContain('/vrt approve');
    expect(html).toContain('Approve <kbd>A</kbd>');
    expect(html).toContain('Reject <kbd>R</kbd>');
    expect(html).toContain('https://github.com/Fiestaboard/demo/pull/7');
  });

  it('shows the approved chip on approved results', () => {
    const s = summary();
    s.results[3].approved = true; // home.png (changed)
    const html = generateHtmlReport(s, meta);
    expect(html).toContain('✓ approved');
  });

  it('marks approved rows in the markdown summary', () => {
    const s = summary();
    s.results[3].approved = true;
    const md = generateMarkdownSummary(s, meta);
    expect(md).toContain('· 1 approved');
    expect(md).toContain('✅ approved');
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
