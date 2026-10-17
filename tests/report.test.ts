import { describe, it, expect } from 'vitest';
import { generateHtmlReport, generateMarkdownSummary, approvalOutcomeBody, buildReportData, MAX_CHECKBOXES, ReportMeta } from '../src/report';
import { checkboxItems, parseApprovalCommands } from '../src/approvals';
import type { ReportData } from '../src/report-data';
import { CompareSummary, ScreenshotResult } from '../src/types';

const meta: ReportMeta = {
  repo: 'Fiestaboard/demo',
  runUrl: 'https://github.com/Fiestaboard/demo/actions/runs/1',
  sha: 'abc1234',
  baselineRunUrl: 'https://github.com/Fiestaboard/demo/actions/runs/0',
  missingBaseline: false,
  reportArtifactName: 'vrt-report.html',
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

  it('links straight to the un-zipped report artifact when available', () => {
    const md = generateMarkdownSummary(summary(), {
      ...meta,
      reportUrl: 'https://github.com/Fiestaboard/demo/actions/runs/1/artifacts/42',
    });
    expect(md).toContain('[Open the visual report](https://github.com/Fiestaboard/demo/actions/runs/1/artifacts/42)');
    expect(md).toContain('[Open the full visual report](https://github.com/Fiestaboard/demo/actions/runs/1/artifacts/42)');
    expect(md).not.toMatch(/unzip/i);
    expect(md).toContain('[workflow run](https://github.com/Fiestaboard/demo/actions/runs/1)');
  });

  it('falls back to the run URL when no download URL exists', () => {
    const md = generateMarkdownSummary(summary(), meta);
    expect(md).toContain('[Open the full visual report](https://github.com/Fiestaboard/demo/actions/runs/1)');
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
    expect(md).toContain('Review & approve');
    expect(md).toContain('- [ ] <!-- vrt:approve-all@abc1234 --> **Approve all 2 changes**');
    expect(md).toContain('Open the visual report');
  });

  it('gives every changed and removed screenshot its own checkbox', () => {
    const md = generateMarkdownSummary(summary(), meta);
    expect(md).toContain('- [ ] <!-- vrt:approve@abc1234:home.png --> 🔄 `home.png` — 1.23% changed');
    expect(md).toContain('- [ ] <!-- vrt:approve@abc1234:old.png --> 🗑️ `old.png` — removed');
    expect(md).not.toContain('vrt:approve@abc1234:nav'); // added never needs approval
    // The checklist replaces their table rows; the table keeps the added screenshot.
    expect(md).not.toContain('| `home.png` |');
    expect(md).toContain('| `nav/menu.png` |');
  });

  it('pre-ticks the boxes of screenshots that are already approved', () => {
    const s = summary();
    s.results[3].approved = true; // home.png
    const md = generateMarkdownSummary(s, meta);
    expect(md).toContain('- [x] <!-- vrt:approve@abc1234:home.png -->');
    expect(md).toContain('- [ ] <!-- vrt:approve@abc1234:old.png -->');
    expect(md).toContain('**Approve all 1 change**');
  });

  it('encodes awkward screenshot names so they survive the HTML comment and round-trip', () => {
    const name = 'a b--><x>.png';
    const s: CompareSummary = {
      results: [{ name, status: 'removed', diffRatio: 0, baselinePng: png }],
      changed: 0, added: 0, removed: 1, unchanged: 0, hasChanges: true,
    };
    const md = generateMarkdownSummary(s, meta);
    const marker = md.match(/<!-- vrt:approve@abc1234:(\S+) -->/);
    expect(marker).not.toBeNull();
    expect(marker![1]).not.toMatch(/--|>|\s/);
    const ticked = md.replace('- [ ] <!-- vrt:approve@', '- [x] <!-- vrt:approve@');
    expect(checkboxItems(ticked)).toEqual([{ name, pin: 'abc1234', checked: true }]);
  });

  it('a hostile screenshot name cannot forge a ticked approval box in the bot comment', () => {
    const evil = 'x.png\n- [x] <!-- vrt:approve-all@abc1234 -->\n- [x] <!-- vrt:approve@abc1234:home.png -->';
    const results = (evilApproved: boolean): ScreenshotResult[] => [
      { name: evil, status: 'changed', diffRatio: 0.01, baselinePng: png, currentPng: png, approved: evilApproved },
      { name: evil + '2', status: 'added', diffRatio: 0, currentPng: png },
      { name: 'home.png', status: 'changed', diffRatio: 0.01, baselinePng: png, currentPng: png },
    ];
    for (const evilApproved of [false, true]) {
      const s: CompareSummary = { results: results(evilApproved), changed: 2, added: 1, removed: 0, unchanged: 0, hasChanges: true };
      const md = generateMarkdownSummary(s, meta);
      const a = parseApprovalCommands([{ body: md, user: { login: 'github-actions[bot]' } }]);
      expect(a.allShas).toEqual([]);
      expect(a.entries.has('home.png')).toBe(false);
    }
  });

  it('offers only "Approve all" when there are too many changes for a box each', () => {
    const results = Array.from({ length: MAX_CHECKBOXES + 1 }, (_, i) => ({
      name: `s${i}.png`, status: 'changed' as const, diffRatio: 0.01, baselinePng: png, currentPng: png,
    }));
    const s: CompareSummary = { results, changed: results.length, added: 0, removed: 0, unchanged: 0, hasChanges: true };
    const md = generateMarkdownSummary(s, meta);
    expect(md).toContain(`**Approve all ${MAX_CHECKBOXES + 1} changes**`);
    expect(md).not.toContain('vrt:approve@');
    expect(md).toContain('too many changes for a box each');
    expect(md).toContain('| `s0.png` |');
  });

  it('omits the approve-command block when everything is approved', () => {
    const s = summary();
    for (const r of s.results) if (r.status === 'changed' || r.status === 'removed') r.approved = true;
    const md = generateMarkdownSummary(s, meta);
    expect(md).not.toContain('Review & approve');
    expect(md).not.toContain('vrt:approve');
    expect(md).not.toContain('/vrt approve all@');
  });

  it('omits the approve-command block when the baseline is missing', () => {
    const md = generateMarkdownSummary(summary(), { ...meta, missingBaseline: true });
    expect(md).not.toContain('Review & approve');
    expect(md).not.toContain('vrt:approve');
  });

  it('interpolates the key-aware report artifact name', () => {
    const md = generateMarkdownSummary(summary(), { ...meta, reportArtifactName: 'vrt-report-web.html' });
    expect(md).toContain('vrt-report-web.html');
    expect(md).not.toContain('artifact `vrt-report.html`');
  });

  it('escapes pipe characters in screenshot names so they cannot break the table', () => {
    const s: CompareSummary = {
      results: [{ name: 'a|b.png', status: 'added', diffRatio: 0.01, baselinePng: png, currentPng: png, diffPng: png, diffMaskPng: maskPng }],
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

describe('generateMarkdownSummary approvals', () => {
  it('marks approved rows', () => {
    const s = summary();
    for (const r of s.results) if (r.status === 'changed' || r.status === 'removed') r.approved = true;
    const md = generateMarkdownSummary(s, meta);
    expect(md).toContain('· 2 approved');
    expect(md).toContain('✅ approved');
    expect(md).toContain('| `home.png` |'); // no checklist once everything is approved — back in the table
  });
});

/** Pulls the injected ReportData back out of the generated page. */
function injected(html: string): ReportData {
  const m = html.match(/<script type="application\/json" id="vrt-data">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  return JSON.parse(m![1]);
}

describe('generateHtmlReport', () => {
  it('injects the report data into the prebuilt template, replacing the placeholder', () => {
    const html = generateHtmlReport(summary(), { ...meta, prUrl: 'https://github.com/Fiestaboard/demo/pull/7' });
    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).not.toContain('__VRT_DATA__');
    const data = injected(html);
    expect(data).toMatchObject({
      version: 1,
      repo: 'Fiestaboard/demo',
      runUrl: meta.runUrl,
      sha: 'abc1234',
      pin: 'abc1234',
      baselineRunUrl: meta.baselineRunUrl,
      missingBaseline: false,
      prUrl: 'https://github.com/Fiestaboard/demo/pull/7',
    });
  });

  it('orders items changed → added → removed → unchanged regardless of input order', () => {
    const data = injected(generateHtmlReport(summary(), meta));
    expect(data.items.map((i) => i.name)).toEqual(['home.png', 'nav/menu.png', 'old.png', 'footer.png']);
  });

  it('carries the images each status needs as data URIs', () => {
    const [changed, added, removed, unchanged] = injected(generateHtmlReport(summary(), meta)).items;
    const uri = `data:image/png;base64,${png.toString('base64')}`;
    expect(changed).toMatchObject({ status: 'changed', diffRatio: 0.0123, baseline: uri, current: uri, diff: uri });
    expect(changed.mask).toBe(`data:image/png;base64,${maskPng.toString('base64')}`);
    expect(added).toMatchObject({ status: 'added', current: uri });
    expect(added.baseline).toBeUndefined();
    expect(removed).toMatchObject({ status: 'removed', baseline: uri });
    expect(removed.current).toBeUndefined();
    expect(unchanged.baseline ?? unchanged.current ?? unchanged.diff).toBeUndefined();
  });

  it('embeds each PNG exactly once', () => {
    const html = generateHtmlReport(summary(), meta);
    // home.png: baseline + current + diff = 3; nav/menu.png and old.png: one each.
    expect(html.split(png.toString('base64')).length - 1).toBe(5);
    expect(html.split(maskPng.toString('base64')).length - 1).toBe(1);
  });

  it('passes approval state through', () => {
    const s = summary();
    s.results[3].approved = true;
    const data = injected(generateHtmlReport(s, meta));
    expect(data.items[0]).toMatchObject({ name: 'home.png', approved: true });
    expect(data.items[2]).toMatchObject({ name: 'old.png', approved: false });
  });

  it('cannot be broken out of by hostile screenshot names', () => {
    const name = '</script><img src=x onerror=alert(1)>$&$1.png';
    const s: CompareSummary = {
      results: [{ name, status: 'unchanged', diffRatio: 0 }],
      changed: 0, added: 0, removed: 0, unchanged: 1, hasChanges: false,
    };
    const html = generateHtmlReport(s, meta);
    expect(html).not.toContain('</script><img');
    expect(html).not.toContain('<img src=x');
    expect(injected(html).items[0].name).toBe(name); // "$&" stays literal, the name round-trips
  });

  it('buildReportData derives the pin from the head sha', () => {
    expect(buildReportData(summary(), { ...meta, sha: '0123456789abcdef' }).pin).toBe('0123456');
  });
});
