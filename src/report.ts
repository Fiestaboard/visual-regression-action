import * as fs from 'fs';
import { CompareSummary, Status } from './types';
import {
  ImageRef,
  ReportData,
  ReportItem,
  IMAGE_ID_PREFIX,
  REPORT_DATA_PLACEHOLDER,
  REPORT_IMAGES_PLACEHOLDER,
} from './report-data';
import { REPORT_TEMPLATE } from './generated/report-template';
import { encodeItemMarker } from './approvals';

export interface ReportMeta {
  repo: string;
  runUrl: string;
  sha: string;
  baselineRunUrl?: string;
  missingBaseline: boolean;
  reportArtifactName: string;
  /** Direct link to the un-zipped report artifact (opens in the browser), when the upload returned an id. */
  reportUrl?: string;
  /** PR the compare ran for — target for pasting /vrt approve commands. */
  prUrl?: string;
  /** pixelmatch threshold of the compare; the report draws its diff with the same. Default 0.1. */
  threshold?: number;
}

const escPipe = (s: string): string => s.replace(/\|/g, '\\|');

const pct = (ratio: number): string => `${(ratio * 100).toFixed(2)}%`;

const STATUS_LABEL: Record<string, string> = {
  changed: '🔄 Changed',
  added: '✨ Added',
  removed: '🗑️ Removed',
  unchanged: '✅ Unchanged',
};

const STATUS_ICON: Record<string, string> = { changed: '🔄', added: '✨', removed: '🗑️', unchanged: '✅' };

/** Most per-screenshot checkboxes the PR comment carries; beyond this only "Approve all" is offered. */
export const MAX_CHECKBOXES = 50;

/**
 * Screenshot names come from the PR's own code. A name with a line break could
 * start a fake "- [x] <!-- vrt:approve-all@… -->" line in the bot's comment,
 * where ticked boxes are trusted — so names never get to break a line.
 */
const oneLine = (s: string): string => s.replace(/[\r\n\u2028\u2029]+/g, ' ');

/** Inline code for a screenshot name: kept on one line, and surviving backticks. */
const codeSpan = (name: string): string => {
  const s = oneLine(name);
  return s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``;
};

const STATUS_ORDER: Status[] = ['changed', 'added', 'removed', 'unchanged'];

export function generateMarkdownSummary(summary: CompareSummary, meta: ReportMeta): string {
  const lines: string[] = ['### Visual regression report', ''];

  if (meta.missingBaseline) {
    lines.push(
      `⚠️ **No baseline found** — all ${summary.added} screenshot(s) recorded as new. ` +
        'Baselines publish on the next default-branch build.',
      ''
    );
  } else if (!summary.hasChanges && summary.added === 0) {
    lines.push(`✅ **No visual changes** across ${summary.unchanged} screenshot(s).`, '');
  } else {
    const approvedCount = summary.results.filter((r) => r.approved).length;
    const needingApproval = summary.changed + summary.removed;
    const approvedNote = approvedCount > 0 ? ` · ${approvedCount} approved` : '';
    lines.push(
      `**${summary.changed} changed · ${summary.added} added · ${summary.removed} removed · ${summary.unchanged} unchanged${approvedNote}**`,
      ''
    );
    if (approvedCount > 0 && approvedCount === needingApproval) {
      lines.push('✅ **All visual changes approved** on this PR.', '');
    } else if (approvedCount > 0) {
      const missing = summary.results
        .filter((r) => (r.status === 'changed' || r.status === 'removed') && !r.approved)
        .map((r) => codeSpan(r.name));
      const shown = missing.slice(0, 10).join(', ');
      const more = missing.length > 10 ? ` …and ${missing.length - 10} more` : '';
      lines.push(
        `⚠️ **${approvedCount} of ${needingApproval} visual changes approved** — still needing review: ${shown}${more}. ` +
          'The check stays red until every changed and removed screenshot is approved.',
        ''
      );
    }
  }

  const pin = meta.sha.slice(0, 7);
  const needing = summary.results.filter((r) => r.status === 'changed' || r.status === 'removed');
  const unapproved = needing.filter((r) => !r.approved);
  const showApproval = unapproved.length > 0 && !meta.missingBaseline;
  // One checkbox per screenshot, unless the list would swamp the comment.
  const perItemBoxes = showApproval && needing.length <= MAX_CHECKBOXES;
  const reportUrl = meta.reportUrl ?? meta.runUrl;

  if (showApproval) {
    const nUn = unapproved.length;
    lines.push(
      '#### Review & approve',
      '',
      `🔍 **[Open the visual report](${reportUrl})** — it opens right in your browser: swipe, overlay, and blink between baseline and current.`,
      '',
      `- [ ] <!-- vrt:approve-all@${pin} --> **Approve all ${nUn} change${nUn === 1 ? '' : 's'}**`
    );
    if (perItemBoxes) {
      for (const r of needing) {
        const box = r.approved ? '[x]' : '[ ]';
        const detail = r.status === 'changed' ? `${pct(r.diffRatio)} changed` : 'removed';
        lines.push(`- ${box} <!-- vrt:approve@${pin}:${encodeItemMarker(r.name)} --> ${STATUS_ICON[r.status]} ${codeSpan(r.name)} — ${detail}`);
      }
      lines.push(
        '',
        'Tick each screenshot you accept, or approve them all. Once every change is ticked, the check reruns and ' +
          'passes automatically (write access required). Pushing new commits resets the boxes.'
      );
    } else {
      lines.push(
        '',
        `Tick the box to accept all ${nUn} — the check reruns and passes automatically (write access required). ` +
          `There are too many changes for a box each; to approve some of them, review them in the report and post the command it builds.`
      );
    }
    lines.push('');
  }

  // The table lists what the checklist doesn't (added screenshots) — or everything, when there's no checklist.
  const tabled = summary.results.filter((r) => r.status !== 'unchanged' && !(perItemBoxes && needing.includes(r)));
  const notable = tabled.slice(0, 50);
  if (notable.length > 0) {
    lines.push('| Status | Screenshot | Diff |', '|---|---|---|');
    for (const r of notable) {
      const diff = r.status === 'changed' ? pct(r.diffRatio) : '—';
      const label = r.approved ? `${STATUS_LABEL[r.status]} · ✅ approved` : STATUS_LABEL[r.status];
      lines.push(`| ${label} | \`${escPipe(oneLine(r.name))}\` | ${diff} |`);
    }
    const hidden = tabled.length - notable.length;
    if (hidden > 0) lines.push('', `…and ${hidden} more.`);
    lines.push('');
  }

  if (showApproval) {
    const entries = unapproved
      .filter((r) => !/\s/.test(r.name))
      .slice(0, 30)
      .map((r) => `${r.name}@${pin}`);
    lines.push(
      '<details>',
      '<summary>Approve by comment instead</summary>',
      '',
      'Post one of these as a PR comment (from an account with write access):',
      '',
      '```',
      '/vrt approve all',
      '```',
      '',
      `Pinned to exactly this commit: \`/vrt approve all@${pin}\``
    );
    if (entries.length > 0) {
      lines.push('', 'Or approve screenshots individually (edit to taste):', '', '```', `/vrt approve ${entries.join(' ')}`, '```');
    }
    lines.push(
      '',
      'No [approvals workflow](https://github.com/Fiestaboard/visual-regression-action#approving-changes) installed? ' +
        'Checkboxes and commands still count — use "Re-run failed jobs" afterwards.',
      '',
      '</details>',
      ''
    );
  }

  if (meta.reportUrl) {
    lines.push(
      `📦 [Open the full visual report](${meta.reportUrl}) (artifact \`${meta.reportArtifactName}\`) · [workflow run](${meta.runUrl})`
    );
  } else {
    lines.push(`📦 [Open the full visual report](${meta.runUrl}) (run artifact \`${meta.reportArtifactName}\`)`);
  }
  if (meta.baselineRunUrl) lines.push('', `Baseline from [this run](${meta.baselineRunUrl}) · commit \`${meta.sha.slice(0, 7)}\``);
  return lines.join('\n');
}

/**
 * Outcome text for the approval-status comment, written by the compare run
 * that follows an approval. Null when there is nothing meaningful to say.
 */
export function approvalOutcomeBody(summary: CompareSummary, meta: ReportMeta): string {
  const needing = summary.changed + summary.removed;
  const approved = summary.results.filter((r) => r.approved).length;
  const run = `[visual check](${meta.runUrl})`;
  if (needing === 0) {
    return `### Check passed\n\n✅ No visual changes needed approval on the latest run — the ${run} passed.`;
  }
  if (approved === needing) {
    return `### Approvals applied\n\n✅ All ${needing} visual change(s) approved — the ${run} passed. Merging publishes the new baselines.`;
  }
  if (approved > 0) {
    const missing = summary.results
      .filter((r) => (r.status === 'changed' || r.status === 'removed') && !r.approved)
      .map((r) => codeSpan(r.name))
      .slice(0, 10)
      .join(', ');
    return (
      `### Approvals partially applied\n\n⚠️ ${approved} of ${needing} visual change(s) approved; still needing review: ${missing}. ` +
      `The ${run} stays red — tick the remaining boxes in the report comment above, or post a fresh command.`
    );
  }
  return (
    `### No approvals matched\n\n❌ The ${run} re-ran, but no posted approval matched — pins go stale when new commits are pushed. ` +
    'Tick the boxes in the refreshed report comment above, or post a fresh command.'
  );
}

/** JSON that is safe inside a <script> element: no "</script>", "<!--" or U+2028/9 breakouts. */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Width and height from a PNG's IHDR chunk, without decoding it. */
export function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** The metadata block, plus the images it refers to, in the order they are embedded. */
export interface BuiltReport {
  data: ReportData;
  images: Array<{ id: string; png: Buffer }>;
}

export function buildReport(summary: CompareSummary, meta: ReportMeta): BuiltReport {
  const ordered = [...summary.results].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name)
  );
  const images: BuiltReport['images'] = [];
  // Images are numbered in review order, so the first cards fill in first.
  const embed = (png: Buffer | undefined): ImageRef | undefined => {
    if (!png) return undefined;
    const id = `${IMAGE_ID_PREFIX}${images.length}`;
    images.push({ id, png });
    return { id, ...pngSize(png) };
  };
  const items = ordered.map((r): ReportItem => {
    const item: ReportItem = { name: r.name, status: r.status, diffRatio: r.diffRatio, approved: !!r.approved };
    if (r.status === 'changed' && r.crop && r.currentPng) {
      item.baseline = embed(r.crop.baselinePng);
      item.current = embed(r.crop.currentPng);
      item.crop = { top: r.crop.top, height: r.crop.height, fullHeight: pngSize(r.currentPng).height };
    } else {
      if (r.status === 'changed' || r.status === 'removed') item.baseline = embed(r.baselinePng);
      if (r.status === 'changed' || r.status === 'added') item.current = embed(r.currentPng);
    }
    return item;
  });
  const data: ReportData = {
    version: 2,
    repo: meta.repo,
    runUrl: meta.runUrl,
    sha: meta.sha,
    pin: meta.sha.slice(0, 7),
    baselineRunUrl: meta.baselineRunUrl,
    missingBaseline: meta.missingBaseline,
    prUrl: meta.prUrl,
    threshold: meta.threshold ?? 0.1,
    items,
  };
  return { data, images };
}

/**
 * The self-contained HTML report, in pieces: the prebuilt FiestaUI reviewer
 * (report-ui/, embedded at build time), this run's metadata, then one element
 * per image. Yielded piecewise so a report of hundreds of megabytes is never
 * held as one string.
 */
export function* htmlReportChunks(summary: CompareSummary, meta: ReportMeta): Generator<string> {
  const { data, images } = buildReport(summary, meta);
  const [beforeData, afterData] = splitOnce(REPORT_TEMPLATE, REPORT_DATA_PLACEHOLDER);
  const [beforeImages, afterImages] = splitOnce(afterData, REPORT_IMAGES_PLACEHOLDER);
  yield beforeData;
  yield scriptSafeJson(data);
  yield beforeImages;
  // Base64 never needs escaping inside a quoted attribute.
  for (const { id, png } of images) yield `<i hidden id="${id}" data-png="${png.toString('base64')}"></i>\n`;
  yield afterImages;
}

function splitOnce(s: string, marker: string): [string, string] {
  const i = s.indexOf(marker);
  if (i < 0) throw new Error(`report template is missing ${marker}`);
  return [s.slice(0, i), s.slice(i + marker.length)];
}

export function generateHtmlReport(summary: CompareSummary, meta: ReportMeta): string {
  return [...htmlReportChunks(summary, meta)].join('');
}

/** Writes the report to `file` piece by piece; returns its size in bytes. */
export function writeHtmlReport(file: string, summary: CompareSummary, meta: ReportMeta): number {
  const fd = fs.openSync(file, 'w');
  let bytes = 0;
  try {
    for (const chunk of htmlReportChunks(summary, meta)) bytes += fs.writeSync(fd, chunk);
  } finally {
    fs.closeSync(fd);
  }
  return bytes;
}
