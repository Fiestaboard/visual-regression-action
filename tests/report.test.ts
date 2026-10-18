import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateHtmlReport, generateMarkdownSummary, approvalOutcomeBody, buildReport, htmlReportChunks, writeHtmlReport, pngSize, MAX_CHECKBOXES, ReportMeta } from '../src/report';
import { makePng } from './helpers/png';
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
// A second, distinct PNG, so each embedded image can be told apart by its bytes.
const png2 = makePng(3, 2, [255, 0, 0, 255]);

function summary(): CompareSummary {
  return {
    // Deliberately not in review order: the HTML must sort changed → added → removed → unchanged.
    results: [
      { name: 'footer.png', status: 'unchanged', diffRatio: 0 },
      { name: 'old.png', status: 'removed', diffRatio: 0, baselinePng: png },
      { name: 'nav/menu.png', status: 'added', diffRatio: 0, currentPng: png },
      { name: 'home.png', status: 'changed', diffRatio: 0.0123, baselinePng: png, currentPng: png2 },
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
      results: [{ name: 'a|b.png', status: 'added', diffRatio: 0.01, baselinePng: png, currentPng: png }],
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

/** The embedded images, as id → bytes, in document order. */
function embedded(html: string): Array<[string, Buffer]> {
  return [...html.matchAll(/<i hidden id="([^"]+)" data-png="([^"]*)"><\/i>/g)].map((m) => [m[1], Buffer.from(m[2], 'base64')]);
}

describe('generateHtmlReport', () => {
  it('fills the prebuilt template with metadata, replacing both placeholders', () => {
    const html = generateHtmlReport(summary(), { ...meta, prUrl: 'https://github.com/Fiestaboard/demo/pull/7', threshold: 0.2 });
    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).not.toContain('__VRT_DATA__');
    expect(html).not.toContain('__VRT_IMAGES__');
    expect(injected(html)).toMatchObject({
      version: 2,
      repo: 'Fiestaboard/demo',
      runUrl: meta.runUrl,
      sha: 'abc1234',
      pin: 'abc1234',
      baselineRunUrl: meta.baselineRunUrl,
      missingBaseline: false,
      prUrl: 'https://github.com/Fiestaboard/demo/pull/7',
      threshold: 0.2,
    });
  });

  it('keeps pixels out of the metadata, so the reviewer can draw before the images arrive', () => {
    const html = generateHtmlReport(summary(), meta);
    const json = html.match(/<script type="application\/json" id="vrt-data">([\s\S]*?)<\/script>/)![1];
    expect(json).not.toContain(png.toString('base64'));
    expect(json.length).toBeLessThan(2000);
  });

  it('orders items changed → added → removed → unchanged regardless of input order', () => {
    const data = injected(generateHtmlReport(summary(), meta));
    expect(data.items.map((i) => i.name)).toEqual(['home.png', 'nav/menu.png', 'old.png', 'footer.png']);
  });

  it('embeds each image once, after the app script, in review order', () => {
    const html = generateHtmlReport(summary(), meta);
    const data = injected(html);
    const [changed, added, removed, unchanged] = data.items;
    expect(changed.baseline).toEqual({ id: 'vrt-img-0', width: 1, height: 1 });
    expect(changed.current).toEqual({ id: 'vrt-img-1', width: 3, height: 2 });
    expect(added.current?.id).toBe('vrt-img-2');
    expect(added.baseline).toBeUndefined();
    expect(removed.baseline?.id).toBe('vrt-img-3');
    expect(removed.current).toBeUndefined();
    expect(unchanged.baseline ?? unchanged.current).toBeUndefined();

    const imgs = embedded(html);
    expect(imgs.map(([id]) => id)).toEqual(['vrt-img-0', 'vrt-img-1', 'vrt-img-2', 'vrt-img-3']);
    expect(imgs[0][1].equals(png)).toBe(true);
    expect(imgs[1][1].equals(png2)).toBe(true);
    // The app runs as soon as it arrives, before the images that follow it.
    const app = html.indexOf('<script type="module" async>');
    expect(app).toBeGreaterThan(html.indexOf('id="vrt-data"'));
    expect(app).toBeLessThan(html.indexOf('id="vrt-img-0"'));
    // No diff or overlay is shipped: the browser computes them.
    expect(html.split(png.toString('base64')).length - 1).toBe(3);
  });

  it('ships the cropped band of a local change and records where it sits', () => {
    const s = summary();
    const band = makePng(3, 1, [0, 0, 255, 255]);
    s.results[3].crop = { top: 900, height: 1, baselinePng: band, currentPng: band };
    const html = generateHtmlReport(s, meta);
    const changed = injected(html).items[0];
    expect(changed.crop).toEqual({ top: 900, height: 1, fullHeight: 2 });
    expect(changed.baseline).toEqual({ id: 'vrt-img-0', width: 3, height: 1 });
    const imgs = embedded(html);
    expect(imgs[0][1].equals(band)).toBe(true);
    expect(imgs.some(([, b]) => b.equals(png2))).toBe(false); // the full current page is not shipped
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

  it('derives the pin from the head sha and defaults the threshold', () => {
    const { data } = buildReport(summary(), { ...meta, sha: '0123456789abcdef' });
    expect(data.pin).toBe('0123456');
    expect(data.threshold).toBe(0.1);
  });

  it('writes to disk exactly what it generates, one piece at a time', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vrt-report-')), 'r.html');
    const bytes = writeHtmlReport(file, summary(), meta);
    const html = generateHtmlReport(summary(), meta);
    expect(fs.readFileSync(file, 'utf8')).toBe(html);
    expect(bytes).toBe(Buffer.byteLength(html));
    expect([...htmlReportChunks(summary(), meta)].length).toBeGreaterThan(4);
  });
});

describe('pngSize', () => {
  it('reads the dimensions from the header', () => {
    expect(pngSize(makePng(7, 5, [0, 0, 0, 255]))).toEqual({ width: 7, height: 5 });
  });
});
