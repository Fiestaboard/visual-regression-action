import { CompareSummary, ScreenshotResult, Status } from './types';

export interface ReportMeta {
  repo: string;
  runUrl: string;
  sha: string;
  baselineRunUrl?: string;
  missingBaseline: boolean;
  reportArtifactName: string;
  /** Direct artifact download URL, when the report upload returned an id. */
  reportDownloadUrl?: string;
  /** PR the compare ran for — target for pasting /vrt approve commands. */
  prUrl?: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escPipe = (s: string): string => s.replace(/\|/g, '\\|');

const pct = (ratio: number): string => `${(ratio * 100).toFixed(2)}%`;

const dataUri = (buf?: Buffer): string =>
  buf ? `data:image/png;base64,${buf.toString('base64')}` : '';

const STATUS_LABEL: Record<string, string> = {
  changed: '🔄 Changed',
  added: '✨ Added',
  removed: '🗑️ Removed',
  unchanged: '✅ Unchanged',
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
      lines.push('✅ **All visual changes approved** via `/vrt approve`.', '');
    } else if (approvedCount > 0) {
      const missing = summary.results
        .filter((r) => (r.status === 'changed' || r.status === 'removed') && !r.approved)
        .map((r) => `\`${r.name}\``);
      const shown = missing.slice(0, 10).join(', ');
      const more = missing.length > 10 ? ` …and ${missing.length - 10} more` : '';
      lines.push(
        `⚠️ **${approvedCount} of ${needingApproval} visual changes approved** — still needing review: ${shown}${more}. ` +
          'The check stays red until every changed and removed screenshot is approved.',
        ''
      );
    }
  }

  const notable = summary.results.filter((r) => r.status !== 'unchanged').slice(0, 50);
  if (notable.length > 0) {
    lines.push('| Status | Screenshot | Diff |', '|---|---|---|');
    for (const r of notable) {
      const diff = r.status === 'changed' ? pct(r.diffRatio) : '—';
      const label = r.approved ? `${STATUS_LABEL[r.status]} · ✅ approved` : STATUS_LABEL[r.status];
      lines.push(`| ${label} | \`${escPipe(r.name)}\` | ${diff} |`);
    }
    const hidden = summary.results.filter((r) => r.status !== 'unchanged').length - notable.length;
    if (hidden > 0) lines.push('', `…and ${hidden} more.`);
    lines.push('');
  }

  const unapproved = summary.results.filter(
    (r) => (r.status === 'changed' || r.status === 'removed') && !r.approved
  );
  if (unapproved.length > 0 && !meta.missingBaseline) {
    const pin = meta.sha.slice(0, 7);
    const entries = unapproved
      .filter((r) => !/\s/.test(r.name))
      .slice(0, 30)
      .map((r) => `${r.name}@${pin}`);
    const dl = meta.reportDownloadUrl ?? meta.runUrl;
    const nUn = unapproved.length;
    lines.push(
      '#### Next steps',
      '',
      `- [ ] <!-- vrt:approve-all@${pin} --> **Approve all ${nUn} change${nUn === 1 ? '' : 's'}** — check this box and the check reruns and passes automatically (write access required)`,
      '',
      `**Want to look first?** [Download the visual report](${dl}), unzip it, and open \`index.html\` — ` +
        'review each change with swipe, overlay, and blink views; approving as you go builds a precise ' +
        'command, and one button copies it and brings you back to this PR.',
      '',
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
        'Checkbox and commands still count — use "Re-run failed jobs" afterwards.',
      '',
      '</details>',
      ''
    );
  }

  if (meta.reportDownloadUrl) {
    lines.push(
      `📦 [Download the full visual report](${meta.reportDownloadUrl}) (artifact \`${meta.reportArtifactName}\`) · [workflow run](${meta.runUrl})`
    );
  } else {
    lines.push(`📦 [Download the full visual report](${meta.runUrl}) (run artifact \`${meta.reportArtifactName}\`)`);
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
      .map((r) => `\`${r.name}\``)
      .slice(0, 10)
      .join(', ');
    return (
      `### Approvals partially applied\n\n⚠️ ${approved} of ${needing} visual change(s) approved; still needing review: ${missing}. ` +
      `The ${run} stays red — copy a fresh command from the report comment above.`
    );
  }
  return (
    `### No approvals matched\n\n❌ The ${run} re-ran, but no posted approval matched — pins go stale when new commits are pushed. ` +
    'Copy a fresh command from the report comment above.'
  );
}

// Each PNG is embedded exactly once: the side-by-side thumbnails carry the
// baseline/current/diff data URIs, the overlay carries the mask. Every other
// <img> (swipe/blink views, the fullscreen reviewer) is populated at load by
// copying those srcs — see the inline script.
function heat(ratio: number): string {
  const width = Math.min(100, Math.round(Math.sqrt(ratio) * 100));
  return `<div class="heat" aria-hidden="true"><i style="width:${width}%"></i></div>`;
}

function voteButtons(): string {
  return `
      <span class="cardvotes">
        <button class="cv approve" type="button" aria-pressed="false" title="Approve (A in reviewer)">✓</button>
        <button class="cv reject" type="button" aria-pressed="false" title="Reject (R in reviewer)">✗</button>
      </span>`;
}

function changedCard(r: ScreenshotResult, pin: string, idx: number): string {
  return `
  <section class="card" id="card-${idx}" data-status="changed" data-pin="${pin}" data-name="${esc(r.name)}" data-ratio="${r.diffRatio}">
    <header>
      <span class="badge changed">${STATUS_LABEL.changed}</span>
      <h3>${esc(r.name)}</h3>
      ${r.approved ? '<span class="okchip">✓ approved</span>' : ''}
      <span class="stat">${pct(r.diffRatio)}</span>${voteButtons()}
      <button class="expand" data-open type="button">Expand ⤢</button>
    </header>
    ${heat(r.diffRatio)}
    <div class="stage" data-mode="swipe">
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" aria-selected="true" data-mode="swipe" type="button">Swipe</button>
        <button class="tab" role="tab" aria-selected="false" data-mode="overlay" type="button">Overlay</button>
        <button class="tab" role="tab" aria-selected="false" data-mode="blink" type="button">Blink</button>
        <button class="tab" role="tab" aria-selected="false" data-mode="sbs" type="button">Side-by-side</button>
      </div>
      <div class="view view-swipe">
        <div class="frame swipe-frame" style="--split:50%">
          <img class="sw-under" alt="current">
          <img class="sw-over" alt="baseline">
          <div class="handle" aria-hidden="true"></div>
        </div>
        <input class="scrub" type="range" min="0" max="100" value="50" aria-label="swipe position">
        <p class="legend">left of the line: baseline · right: current</p>
      </div>
      <div class="view view-overlay">
        <div class="frame peek-frame">
          <img class="ov-cur" alt="current">
          <img class="ov-mask" src="${dataUri(r.diffMaskPng)}" alt="changed pixels highlighted">
        </div>
        <div class="ovrow">
          <label class="legend">mask <input class="maskop" type="range" min="0" max="100" value="100" aria-label="mask opacity"></label>
          <span class="legend">press and hold the image to peek underneath</span>
        </div>
      </div>
      <div class="view view-blink">
        <div class="frame blink-frame">
          <img class="bl-base" alt="baseline">
          <img class="bl-cur" alt="current">
        </div>
        <p class="legend">alternating baseline ↔ current — motion off? click the image to flip</p>
      </div>
      <div class="view view-sbs">
        <div class="thumbs">
          <figure><figcaption>Baseline</figcaption><img class="shot-baseline" src="${dataUri(r.baselinePng)}" alt="baseline"></figure>
          <figure><figcaption>Current</figcaption><img class="shot-current" src="${dataUri(r.currentPng)}" alt="current"></figure>
          <figure><figcaption>Diff</figcaption><img class="shot-diff" src="${dataUri(r.diffPng)}" alt="diff"></figure>
        </div>
      </div>
    </div>
  </section>`;
}

function simpleCard(r: ScreenshotResult, extraPin: string, idx: number): string {
  const img =
    r.status === 'added'
      ? `<img class="shot-current" src="${dataUri(r.currentPng)}" alt="current (new)">`
      : `<img class="shot-baseline" src="${dataUri(r.baselinePng)}" alt="baseline (removed)">`;
  const caption = r.status === 'added' ? 'Current (new)' : 'Baseline (removed)';
  const pin = r.status === 'removed' ? ` data-pin="${extraPin}"` : '';
  const votes = r.status === 'removed' ? voteButtons() : '';
  return `
  <section class="card" id="card-${idx}" data-status="${r.status}"${pin} data-name="${esc(r.name)}" data-ratio="0">
    <header>
      <span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span>
      <h3>${esc(r.name)}</h3>
      ${r.approved ? '<span class="okchip">✓ approved</span>' : ''}${votes}
      <button class="expand" data-open type="button">Expand ⤢</button>
    </header>
    <div class="single"><figure><figcaption>${caption}</figcaption>${img}</figure></div>
  </section>`;
}

function unchangedCard(r: ScreenshotResult, idx: number): string {
  return `
  <section class="card slim" id="card-${idx}" data-status="unchanged" data-name="${esc(r.name)}" data-ratio="0">
    <header>
      <span class="badge unchanged">${STATUS_LABEL.unchanged}</span>
      <h3>${esc(r.name)}</h3>
    </header>
  </section>`;
}

function card(r: ScreenshotResult, pin: string, idx: number): string {
  if (r.status === 'changed') return changedCard(r, pin, idx);
  if (r.status === 'unchanged') return unchangedCard(r, idx);
  return simpleCard(r, pin, idx);
}

const DOT: Record<string, string> = { changed: 'changed', added: 'added', removed: 'removed', unchanged: 'unchanged' };

function sidebarRow(r: ScreenshotResult, idx: number): string {
  const detail = r.status === 'changed' ? pct(r.diffRatio) : r.status;
  return `
    <a class="siderow" href="#card-${idx}" data-idx="${idx}">
      <span class="dot ${DOT[r.status]}"></span>
      <span class="sidename">${esc(r.name)}</span>
      <span class="sidepct">${detail}</span>
    </a>`;
}

export function generateHtmlReport(summary: CompareSummary, meta: ReportMeta): string {
  const counts = [
    ['changed', summary.changed],
    ['added', summary.added],
    ['removed', summary.removed],
    ['unchanged', summary.unchanged],
  ] as const;
  const ordered = [...summary.results].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name)
  );
  const reviewable = ordered.filter((r) => r.status !== 'unchanged').length;
  const pin = meta.sha.slice(0, 7);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual regression report — ${esc(meta.repo)}</title>
<style>
  :root { color-scheme: light dark;
    --bg:#fafafa; --fg:#1a1a1a; --card:#fff; --line:#e2e2e2; --muted:#6b6b6b;
    --hot:#ec4899; --warn:#b45309;
    --changed:#be185d; --changed-bg:#fce7f3; --added:#1d4ed8; --added-bg:#dbeafe;
    --removed:#b91c1c; --removed-bg:#fee2e2; --unchanged:#15803d; --unchanged-bg:#dcfce7; }
  @media (prefers-color-scheme: dark) { :root {
    --bg:#111214; --fg:#e8e8e8; --card:#1b1d21; --line:#2e3138; --muted:#9a9a9a; --warn:#fbbf24;
    --changed-bg:#4a1030; --changed:#f9a8d4; --added-bg:#172a54; --added:#93c5fd;
    --removed-bg:#450f0f; --removed:#fca5a5; --unchanged-bg:#0f3520; --unchanged:#86efac; } }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif }
  button { font:inherit; color:var(--fg); cursor:pointer }
  .top { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line);
    padding:14px 24px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; z-index:2 }
  .top h1 { font-size:18px; margin:0 auto 0 0 }
  .progress { width:100%; display:flex; gap:14px; align-items:center; flex-wrap:wrap }
  .progress .ptext { font-size:14px; font-weight:600 }
  .progress .ptext.done { color:var(--unchanged) }
  .top .meta { color:var(--muted); font-size:13px; width:100% }
  button.filter { border:1px solid var(--line); background:var(--card);
    border-radius:999px; padding:4px 14px; font-size:13px }
  button.filter[aria-pressed="true"] { outline:2px solid var(--fg) }
  button.review { border:0; background:var(--hot); color:#fff; border-radius:999px;
    padding:7px 20px; font-size:14px; font-weight:700 }
  select.sort { font:inherit; font-size:13px; border:1px solid var(--line); border-radius:8px;
    padding:4px 8px; background:var(--card); color:var(--fg) }
  .wrap { display:grid; grid-template-columns:250px minmax(0,1fr); gap:0; max-width:1360px; margin:0 auto }
  @media (max-width:900px) { .wrap { grid-template-columns:1fr } .side { display:none } }
  .side { position:sticky; top:76px; align-self:start; max-height:calc(100vh - 76px);
    overflow-y:auto; padding:16px 8px 40px 16px }
  .siderow { display:flex; gap:8px; align-items:center; padding:6px 10px; border-radius:8px;
    text-decoration:none; color:var(--fg); font-size:13px }
  .siderow:hover { background:var(--card) }
  .siderow.active { background:var(--card); outline:1px solid var(--line) }
  .siderow.hidden { display:none }
  .dot { width:8px; height:8px; border-radius:50%; flex:none }
  .dot.changed { background:var(--hot) }
  .dot.added { background:var(--added) }
  .dot.removed { background:var(--removed) }
  .dot.unchanged { background:var(--unchanged) }
  .sidename { font-family:ui-monospace,Menlo,monospace; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; flex:1; min-width:0 }
  .sidepct { color:var(--muted); font-size:11px; font-variant-numeric:tabular-nums; flex:none }
  .siderow .sidemark { flex:none; font-size:11px; width:12px; text-align:center }
  main { min-width:0; padding:24px; padding-bottom:96px }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:20px; margin-bottom:24px; scroll-margin-top:90px }
  .card.slim { padding:12px 20px }
  .card.hidden { display:none }
  .card header { display:flex; gap:10px; align-items:center }
  .card:not(.slim) header { margin-bottom:10px }
  .card h3 { margin:0 auto 0 0; font-size:15px; font-family:ui-monospace,Menlo,monospace; word-break:break-all }
  .stat { font-family:ui-monospace,Menlo,monospace; font-size:13px; color:var(--changed);
    font-variant-numeric:tabular-nums }
  .heat { height:3px; border-radius:2px; background:var(--line); margin:0 0 14px; overflow:hidden }
  .heat i { display:block; height:100%; background:var(--hot) }
  .badge { border-radius:999px; padding:2px 10px; font-size:12px; font-weight:600; white-space:nowrap }
  .badge.changed { background:var(--changed-bg); color:var(--changed) }
  .badge.added { background:var(--added-bg); color:var(--added) }
  .badge.removed { background:var(--removed-bg); color:var(--removed) }
  .badge.unchanged { background:var(--unchanged-bg); color:var(--unchanged) }
  .okchip { border-radius:999px; padding:2px 10px; font-size:12px; font-weight:600;
    background:var(--unchanged-bg); color:var(--unchanged); white-space:nowrap }
  .cardvotes { display:flex; gap:4px }
  button.cv { border:1px solid var(--line); background:transparent; border-radius:8px;
    width:30px; height:28px; font-size:14px; line-height:1 }
  button.cv.approve[aria-pressed="true"] { background:#15803d; border-color:#15803d; color:#fff }
  button.cv.reject[aria-pressed="true"] { background:#b91c1c; border-color:#b91c1c; color:#fff }
  button.expand { border:1px solid var(--line); background:transparent; border-radius:8px;
    padding:4px 10px; font-size:12px; white-space:nowrap }
  .tabs { display:flex; gap:4px; margin-bottom:10px; flex-wrap:wrap }
  .tab { border:1px solid var(--line); background:transparent; border-radius:8px;
    padding:4px 12px; font-size:13px }
  .tab[aria-selected="true"] { background:var(--fg); color:var(--bg); border-color:var(--fg) }
  .stage .view { display:none }
  .stage[data-mode="swipe"] .view-swipe { display:block }
  .stage[data-mode="overlay"] .view-overlay { display:block }
  .stage[data-mode="blink"] .view-blink { display:block }
  .stage[data-mode="sbs"] .view-sbs { display:block }
  .frame { position:relative; border:1px solid var(--line); border-radius:8px; overflow:hidden;
    background:#fff; line-height:0 }
  .stage, .lightbox { user-select:none; -webkit-user-select:none }
  .frame img, .lb-canvas img, .thumbs img { -webkit-user-drag:none }
  .frame img { width:100%; display:block }
  .sw-over { position:absolute; inset:0; clip-path:inset(0 calc(100% - var(--split)) 0 0) }
  .handle { position:absolute; top:0; bottom:0; left:var(--split); width:2px; margin-left:-1px;
    background:var(--hot); box-shadow:0 0 0 1px rgba(255,255,255,.6) }
  .handle::after { content:'◂ ▸'; position:absolute; top:50%; left:50%;
    transform:translate(-50%,-50%); background:var(--hot); color:#fff; font-size:10px;
    line-height:1; padding:5px 6px; border-radius:999px; white-space:nowrap }
  .ov-mask { position:absolute; inset:0 }
  .bl-cur { position:absolute; inset:0 }
  .blink-frame.showbase .bl-cur { visibility:hidden }
  .ovrow { display:flex; gap:16px; align-items:center; margin-top:6px; flex-wrap:wrap }
  .maskop { width:140px; vertical-align:middle; accent-color:var(--hot) }
  .scrub { width:100%; margin-top:10px; accent-color:var(--hot) }
  .legend { margin:6px 0 0; font-size:12px; color:var(--muted) }
  .thumbs { display:flex; gap:12px; flex-wrap:wrap }
  .thumbs figure, .single figure { flex:1 1 250px; min-width:0; margin:0 }
  figcaption { font-size:12px; color:var(--muted); text-transform:uppercase;
    letter-spacing:.05em; margin-bottom:6px }
  .thumbs img, .single img { max-width:100%; width:auto; border:1px solid var(--line);
    border-radius:6px; display:block; background:#fff }
  .single img { width:100% }
  /* Fullscreen reviewer */
  .lightbox { position:fixed; inset:0; z-index:10; background:#0b0b0e; color:#e8e8e8;
    display:flex; flex-direction:column }
  .lightbox[hidden] { display:none }
  .lb-bar { display:flex; gap:12px; align-items:center; padding:12px 20px; flex-wrap:wrap }
  .lb-name { font-family:ui-monospace,Menlo,monospace; font-size:14px; word-break:break-all }
  .lb-count { font-variant-numeric:tabular-nums; color:#9a9a9a; font-size:13px }
  .lb-stat { color:var(--hot); font-family:ui-monospace,Menlo,monospace; font-size:13px }
  .lb-dots { display:flex; gap:5px; align-items:center; flex-wrap:wrap }
  .lb-dots button { width:10px; height:10px; border-radius:50%; border:1px solid #5a5d64;
    background:transparent; padding:0 }
  .lb-dots button.yes { background:#15803d; border-color:#15803d }
  .lb-dots button.no { background:#b91c1c; border-color:#b91c1c }
  .lb-dots button.cur { outline:2px solid #e8e8e8; outline-offset:1px }
  button.vote { border:1px solid #3a3d44; background:transparent; color:#e8e8e8;
    border-radius:8px; padding:4px 12px; font-size:13px }
  button.vote.approve[aria-pressed="true"] { background:#15803d; border-color:#15803d; color:#fff }
  button.vote.reject[aria-pressed="true"] { background:#b91c1c; border-color:#b91c1c; color:#fff }
  button.lb-skip { border:1px solid #3a3d44; background:transparent; color:#e8e8e8;
    border-radius:8px; padding:4px 12px; font-size:13px }
  .lb-tally { color:#9a9a9a; font-size:13px; font-variant-numeric:tabular-nums }
  .lb-bar .tabs { margin:0 0 0 auto }
  .lightbox .tab { border-color:#3a3d44; color:#e8e8e8 }
  .lightbox .tab[aria-selected="true"] { background:#e8e8e8; color:#111; border-color:#e8e8e8 }
  button.lb-close { border:1px solid #3a3d44; background:transparent; color:#e8e8e8;
    border-radius:8px; padding:4px 12px; font-size:13px }
  .lb-nav { position:absolute; top:50%; transform:translateY(-50%); z-index:11;
    display:flex; flex-direction:column; align-items:center; gap:6px;
    border:1px solid #3a3d44; background:rgba(27,29,33,.9); color:#e8e8e8;
    border-radius:12px; padding:14px 12px; font-size:22px; line-height:1 }
  .lb-nav kbd { font-size:10px }
  .lb-nav.prev { left:16px }
  .lb-nav.next { right:16px }
  .lb-nav:hover { background:#2a2d33 }
  .lb-stage-wrap { flex:1; position:relative; display:flex; min-height:0 }
  .lb-zoom { flex:1; overflow:hidden; position:relative; cursor:grab }
  .lb-zoom.panning { cursor:grabbing }
  .lb-canvas { position:absolute; top:50%; left:50%; transform-origin:0 0; line-height:0 }
  .lb-canvas .frame { border-color:#3a3d44; border-radius:4px }
  .lb-canvas .thumbs { flex-wrap:nowrap }
  .lb-canvas .thumbs figure { flex:0 0 auto }
  .lb-canvas .thumbs img { max-width:none }
  .lb-foot { display:flex; gap:18px; padding:10px 20px; font-size:12px; color:#9a9a9a;
    flex-wrap:wrap; align-items:center }
  .lb-foot .scrub { width:220px; margin:0 }
  kbd { border:1px solid #3a3d44; border-bottom-width:2px; border-radius:4px;
    padding:0 5px; font:11px ui-monospace,Menlo,monospace }
  .cmdbar { position:fixed; left:0; right:0; bottom:0; z-index:12; display:flex; gap:10px;
    align-items:center; flex-wrap:wrap; padding:12px 20px; background:var(--card);
    border-top:2px solid var(--hot); box-shadow:0 -4px 16px rgba(0,0,0,.15) }
  .cmdbar[hidden] { display:none }
  .cmdbar.partial { border-top-color:var(--warn) }
  .cmdbar.complete { border-top-color:var(--unchanged) }
  .cmdbar.complete .coverage { color:var(--unchanged); font-weight:600 }
  .cmdbar .coverage { font-size:13px; color:var(--muted); flex:1 1 100% }
  .cmdbar.partial .coverage { color:var(--warn); font-weight:600 }
  .cmdbar input.cmd { flex:1 1 320px; min-width:0; font:13px ui-monospace,Menlo,monospace;
    padding:8px 10px; border:1px solid var(--line); border-radius:8px;
    background:var(--bg); color:var(--fg) }
  .cmdbar .copy, .cmdbar .go { border:0; background:var(--hot); color:#fff; border-radius:8px;
    padding:8px 16px; font-size:13px; font-weight:600; text-decoration:none; white-space:nowrap }
  .cmdbar .copy { background:transparent; color:var(--fg); border:1px solid var(--line) }
  .cmdbar .reset { border:0; background:transparent; color:var(--muted); font-size:12px;
    text-decoration:underline; white-space:nowrap }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important } }
</style>
</head>
<body>
<div class="top">
  <h1>Visual regression report</h1>
  ${reviewable > 0 ? `<button class="review" data-open-first type="button">Start review</button>` : ''}
  ${counts
    .map(
      ([k, n]) =>
        `<button class="filter" aria-pressed="true" data-status="${k}" type="button">${STATUS_LABEL[k]} · ${n}</button>`
    )
    .join('\n  ')}
  <select class="sort" aria-label="sort order">
    <option value="review">Review order</option>
    <option value="ratio">Largest diff first</option>
  </select>
  <div class="progress"><span class="ptext"></span></div>
  <div class="meta">${esc(meta.repo)} · commit ${esc(pin)} · <a href="${esc(meta.runUrl)}">workflow run</a>${
    meta.baselineRunUrl ? ` · baseline from <a href="${esc(meta.baselineRunUrl)}">this run</a>` : ''
  }${meta.missingBaseline ? ' · ⚠️ no baseline found — everything is new' : ''}</div>
</div>
<div class="wrap">
<aside class="side">
${ordered.map(sidebarRow).join('\n')}
</aside>
<main>
${ordered.map((r, i) => card(r, pin, i)).join('\n')}
</main>
</div>
<div class="lightbox" hidden>
  <div class="lb-bar">
    <span class="lb-count"></span>
    <span class="lb-name"></span>
    <span class="lb-stat"></span>
    <button class="vote approve" type="button" aria-pressed="false">Approve <kbd>A</kbd></button>
    <button class="vote reject" type="button" aria-pressed="false">Reject <kbd>R</kbd></button>
    <button class="lb-skip" type="button">Next unreviewed <kbd>U</kbd></button>
    <span class="lb-tally"></span>
    <div class="lb-dots" role="tablist" aria-label="review progress"></div>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-mode="swipe" type="button">Swipe <kbd>S</kbd></button>
      <button class="tab" role="tab" data-mode="overlay" type="button">Overlay <kbd>O</kbd></button>
      <button class="tab" role="tab" data-mode="blink" type="button">Blink <kbd>B</kbd></button>
      <button class="tab" role="tab" data-mode="sbs" type="button">Side-by-side <kbd>D</kbd></button>
    </div>
    <button class="lb-close" type="button">Close <kbd>Esc</kbd></button>
  </div>
  <div class="lb-stage-wrap">
    <button class="lb-nav prev" type="button" aria-label="previous screenshot">‹<kbd>←</kbd></button>
    <div class="lb-zoom"><div class="lb-canvas"></div></div>
    <button class="lb-nav next" type="button" aria-label="next screenshot">›<kbd>→</kbd></button>
  </div>
  <div class="lb-foot">
    <input class="scrub" type="range" min="0" max="100" value="50" aria-label="swipe position">
    <span>scroll to zoom · drag to pan · double-click resets · <kbd>J</kbd>/<kbd>K</kbd> also navigate</span>
  </div>
</div>
<div class="cmdbar" hidden>
  <span class="coverage"></span>
  <input class="cmd" readonly aria-label="approval command">
  ${meta.prUrl ? `<button class="go" type="button">Copy &amp; open PR ↗</button>` : ''}
  <button class="copy" type="button">Copy</button>
  <button class="reset" type="button">Reset review</button>
</div>
<script>
(function () {
  'use strict';
  var PR_URL = ${meta.prUrl ? `'${esc(meta.prUrl)}'` : 'null'};
  var STORE_KEY = 'vrt-review:' + ${JSON.stringify(meta.runUrl)};
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- filters ---
  document.querySelectorAll('button.filter').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      document.querySelectorAll('.card[data-status="' + btn.dataset.status + '"]').forEach(function (c) {
        c.classList.toggle('hidden', !on);
      });
      document.querySelectorAll('.siderow').forEach(function (row) {
        var c = document.getElementById('card-' + row.dataset.idx);
        row.classList.toggle('hidden', c.classList.contains('hidden'));
      });
    });
  });

  // --- per-card wiring: copy embedded srcs, tabs, swipe scrub, peek, mask opacity, blink ---
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card:not([data-status="unchanged"])'));
  cards.forEach(function (c) {
    var b = c.querySelector('.shot-baseline'), cur = c.querySelector('.shot-current');
    var under = c.querySelector('.sw-under'), over = c.querySelector('.sw-over'), ovc = c.querySelector('.ov-cur');
    var blb = c.querySelector('.bl-base'), blc = c.querySelector('.bl-cur');
    // The clipped top layer shows LEFT of the split line — that side is the baseline.
    if (cur && under) under.src = cur.src;
    if (b && over) over.src = b.src;
    if (cur && ovc) ovc.src = cur.src;
    if (b && blb) blb.src = b.src;
    if (cur && blc) blc.src = cur.src;
    c.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { setMode(c.querySelector('.stage'), tab.dataset.mode, c); });
    });
    var frame = c.querySelector('.swipe-frame'), scrub = c.querySelector('.scrub');
    if (frame && scrub) {
      var setSplit = function (v) { frame.style.setProperty('--split', v + '%'); scrub.value = v; };
      scrub.addEventListener('input', function () { setSplit(scrub.value); });
      frame.addEventListener('pointerdown', function (e) {
        frame.setPointerCapture(e.pointerId);
        var move = function (ev) {
          var r = frame.getBoundingClientRect();
          setSplit(Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)).toFixed(1));
        };
        move(e);
        frame.addEventListener('pointermove', move);
        frame.addEventListener('pointerup', function up() {
          frame.removeEventListener('pointermove', move);
          frame.removeEventListener('pointerup', up);
        });
      });
    }
    var peek = c.querySelector('.peek-frame'), mask = c.querySelector('.ov-mask'), maskop = c.querySelector('.maskop');
    if (peek && mask) {
      var restore = function () { mask.style.opacity = (maskop ? maskop.value : 100) / 100; };
      peek.addEventListener('pointerdown', function () { mask.style.opacity = 0; });
      peek.addEventListener('pointerup', restore);
      peek.addEventListener('pointerleave', restore);
      if (maskop) maskop.addEventListener('input', restore);
    }
    var blink = c.querySelector('.blink-frame');
    if (blink) blink.addEventListener('click', function () { blink.classList.toggle('showbase'); });
  });
  if (!reduced) {
    setInterval(function () {
      document.querySelectorAll('.stage[data-mode="blink"] .blink-frame, .lb-canvas .blink-frame').forEach(function (f) {
        f.classList.toggle('showbase');
      });
    }, 900);
  }
  function setMode(stage, mode, scope) {
    if (!stage) return;
    stage.setAttribute('data-mode', mode);
    scope.querySelectorAll('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', String(t.dataset.mode === mode));
    });
  }

  // --- decisions: persisted per run in localStorage ---
  var decisions = cards.map(function () { return null; });
  function saveDecisions() {
    try {
      var obj = {};
      cards.forEach(function (c, i) { if (decisions[i] !== null) obj[c.getAttribute('data-name')] = decisions[i]; });
      localStorage.setItem(STORE_KEY, JSON.stringify(obj));
    } catch (e) {}
  }
  function loadDecisions() {
    try {
      var obj = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      cards.forEach(function (c, i) {
        var v = obj[c.getAttribute('data-name')];
        if (v === true || v === false) decisions[i] = v;
      });
    } catch (e) {}
  }
  function votable(i) { return !!cards[i].getAttribute('data-pin'); }
  function setDecision(i, v) {
    if (!votable(i)) return;
    decisions[i] = decisions[i] === v ? null : v;
    saveDecisions();
    updateAll();
  }
  function updateCardVotes() {
    cards.forEach(function (c, i) {
      var a = c.querySelector('.cv.approve'), r = c.querySelector('.cv.reject');
      if (a) a.setAttribute('aria-pressed', String(decisions[i] === true));
      if (r) r.setAttribute('aria-pressed', String(decisions[i] === false));
    });
  }
  cards.forEach(function (c, i) {
    var a = c.querySelector('.cv.approve'), r = c.querySelector('.cv.reject');
    if (a) a.addEventListener('click', function () { setDecision(i, true); });
    if (r) r.addEventListener('click', function () { setDecision(i, false); });
  });

  // --- progress header + sort + J/K ---
  var ptext = document.querySelector('.progress .ptext');
  function updateProgress() {
    var total = 0, done = 0;
    cards.forEach(function (c, i) { if (votable(i)) { total++; if (decisions[i] !== null) done++; } });
    if (total === 0) { ptext.textContent = '✅ Nothing needs review.'; return; }
    ptext.textContent = done + ' of ' + total + ' reviewed' + (done === total ? ' — review complete, post the command below' : '');
    ptext.classList.toggle('done', done === total);
  }
  document.querySelector('select.sort').addEventListener('change', function (e) {
    var byRatio = e.target.value === 'ratio';
    var main = document.querySelector('main'), side = document.querySelector('aside.side');
    var order = Array.prototype.slice.call(document.querySelectorAll('main .card'));
    order.sort(function (x, y) {
      if (byRatio) return parseFloat(y.getAttribute('data-ratio')) - parseFloat(x.getAttribute('data-ratio'));
      return parseInt(x.id.slice(5), 10) - parseInt(y.id.slice(5), 10);
    });
    order.forEach(function (c) { main.appendChild(c); });
    var rows = Array.prototype.slice.call(document.querySelectorAll('.siderow'));
    order.forEach(function (c) {
      var row = rows.filter(function (r) { return 'card-' + r.dataset.idx === c.id; })[0];
      if (row) side.appendChild(row);
    });
  });
  function visibleCards() {
    return Array.prototype.slice.call(document.querySelectorAll('main .card:not(.hidden):not([data-status="unchanged"])'));
  }
  function scrollToCard(delta) {
    var vis = visibleCards();
    if (!vis.length) return;
    var y = window.scrollY + 100;
    var idx = 0;
    vis.forEach(function (c, i) { if (c.offsetTop <= y + 4) idx = i; });
    var next = vis[Math.max(0, Math.min(vis.length - 1, idx + delta))];
    next.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }

  // --- sidebar active highlight ---
  var rowsByCard = {};
  document.querySelectorAll('.siderow').forEach(function (row) { rowsByCard['card-' + row.dataset.idx] = row; });
  function updateSidebarMarks() {
    cards.forEach(function (c, i) {
      var row = rowsByCard[c.id];
      if (!row) return;
      var mark = row.querySelector('.sidemark');
      if (!mark) { mark = document.createElement('span'); mark.className = 'sidemark'; row.appendChild(mark); }
      mark.textContent = decisions[i] === true ? '✓' : decisions[i] === false ? '✗' : '';
      mark.style.color = decisions[i] === true ? 'var(--unchanged)' : 'var(--removed)';
    });
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          document.querySelectorAll('.siderow.active').forEach(function (r) { r.classList.remove('active'); });
          var row = rowsByCard[en.target.id];
          if (row) row.classList.add('active');
        }
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    document.querySelectorAll('main .card').forEach(function (c) { io.observe(c); });
  }

  // --- fullscreen reviewer ---
  var lb = document.querySelector('.lightbox');
  var canvas = lb.querySelector('.lb-canvas');
  var zoomWrap = lb.querySelector('.lb-zoom');
  var lbScrub = lb.querySelector('.lb-foot .scrub');
  var voteA = lb.querySelector('.vote.approve');
  var voteR = lb.querySelector('.vote.reject');
  var dotsWrap = lb.querySelector('.lb-dots');
  var cmdbar = document.querySelector('.cmdbar');
  var cmdInput = cmdbar.querySelector('.cmd');
  var idx = 0, scale = 1, tx = 0, ty = 0, mode = 'swipe';
  function apply() {
    canvas.style.transform = 'translate(-50%,-50%) translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }
  function resetZoom() { scale = 1; tx = 0; ty = 0; apply(); }
  function buildDots() {
    dotsWrap.innerHTML = '';
    cards.forEach(function (c, i) {
      if (!votable(i)) return;
      var d = document.createElement('button');
      d.type = 'button';
      d.setAttribute('aria-label', c.getAttribute('data-name'));
      d.addEventListener('click', function () { resetZoom(); show(i); });
      d.dataset.i = i;
      dotsWrap.appendChild(d);
    });
  }
  function updateDots() {
    dotsWrap.querySelectorAll('button').forEach(function (d) {
      var i = parseInt(d.dataset.i, 10);
      d.className = decisions[i] === true ? 'yes' : decisions[i] === false ? 'no' : '';
      if (i === idx) d.classList.add('cur');
    });
  }
  function updateTally() {
    var total = 0, yes = 0, no = 0;
    cards.forEach(function (c, i) {
      if (!votable(i)) return;
      total++;
      if (decisions[i] === true) yes++;
      if (decisions[i] === false) no++;
    });
    lb.querySelector('.lb-tally').textContent =
      total ? yes + ' approved · ' + no + ' rejected · ' + (total - yes - no) + ' left' : '';
  }
  function updateCmdbar() {
    var entries = [], total = 0, rejected = 0;
    cards.forEach(function (c, i) {
      var h = c.getAttribute('data-pin');
      if (!h) return;
      total++;
      if (decisions[i] === true) entries.push(c.getAttribute('data-name') + '@' + h);
      if (decisions[i] === false) rejected++;
    });
    cmdbar.hidden = total === 0;
    if (total === 0) return;
    var cov = cmdbar.querySelector('.coverage');
    var copyBtn = cmdbar.querySelector('.copy');
    var goBtn = cmdbar.querySelector('.go');
    cmdInput.hidden = entries.length === 0;
    copyBtn.hidden = entries.length === 0;
    if (goBtn) goBtn.hidden = entries.length === 0;
    cmdbar.classList.remove('partial', 'complete');
    var unreviewed = total - entries.length - rejected;
    if (entries.length === 0 && rejected === 0) {
      cov.textContent = '1. Review each change (A approve / R reject) · 2. Copy the command that assembles here · 3. Post it as a PR comment — or just tick the approve-all box already on the PR';
    } else if (entries.length === 0) {
      cov.textContent = rejected + ' rejected · 0 approved — nothing to post. Fix the rejected changes and push, or approve the intentional ones.';
      cmdbar.classList.add('partial');
    } else if (unreviewed > 0) {
      cov.textContent = '⚠️ Covers ' + entries.length + ' of ' + total + ' — ' + unreviewed +
        ' still unreviewed. The check stays red until every changed/removed screenshot is approved.';
      cmdbar.classList.add('partial');
      cmdInput.value = '/vrt approve ' + entries.join(' ');
    } else if (rejected > 0) {
      cov.textContent = 'Covers ' + entries.length + ' of ' + total + ' — ' + rejected +
        ' rejected (check stays red until those are fixed). Post as a PR comment:';
      cmdInput.value = '/vrt approve ' + entries.join(' ');
    } else {
      cov.textContent = '✅ Covers all ' + total + ' changes — post as a PR comment and the check will pass:';
      cmdbar.classList.add('complete');
      cmdInput.value = '/vrt approve ' + entries.join(' ');
    }
  }
  function updateAll() {
    updateCardVotes();
    updateSidebarMarks();
    updateProgress();
    updateTally();
    updateDots();
    updateCmdbar();
  }
  function vote(v) {
    if (!votable(idx)) return;
    var had = decisions[idx];
    setDecision(idx, v);
    if (decisions[idx] !== null && had === null) { resetZoom(); show(idx + 1); } else { show(idx); }
  }
  function nextUnreviewed() {
    for (var k = 1; k <= cards.length; k++) {
      var i = (idx + k) % cards.length;
      if (votable(i) && decisions[i] === null) { resetZoom(); show(i); return; }
    }
  }
  function show(i) {
    idx = (i + cards.length) % cards.length;
    var c = cards[idx];
    var status = c.getAttribute('data-status');
    lb.querySelector('.lb-count').textContent = (idx + 1) + ' / ' + cards.length;
    lb.querySelector('.lb-name').textContent = c.getAttribute('data-name');
    var stat = c.querySelector('.stat');
    lb.querySelector('.lb-stat').textContent = stat ? stat.textContent + ' changed' : (status === 'added' ? 'new screenshot' : 'removed screenshot');
    var changed = status === 'changed';
    lb.querySelectorAll('.lb-bar .tab').forEach(function (t) {
      t.style.display = changed ? '' : 'none';
      t.setAttribute('aria-selected', String(changed && t.dataset.mode === mode));
    });
    lbScrub.style.display = changed && mode === 'swipe' ? '' : 'none';
    var isVotable = votable(idx);
    voteA.style.display = isVotable ? '' : 'none';
    voteR.style.display = isVotable ? '' : 'none';
    voteA.setAttribute('aria-pressed', String(decisions[idx] === true));
    voteR.setAttribute('aria-pressed', String(decisions[idx] === false));
    var src = function (sel) { var el = c.querySelector(sel); return el ? el.src : ''; };
    var w = 'min(88vw, 1400px)';
    var html;
    if (!changed) {
      html = '<div class="frame" style="width:' + w + '"><img src="' + src('.single img') + '" alt=""></div>';
    } else if (mode === 'overlay') {
      html = '<div class="frame" style="width:' + w + '"><img src="' + src('.shot-current') + '" alt="current">' +
        '<img class="ov-mask" src="' + src('.ov-mask') + '" alt="changed pixels"></div>';
    } else if (mode === 'blink') {
      html = '<div class="frame blink-frame" style="width:' + w + '">' +
        '<img src="' + src('.shot-baseline') + '" alt="baseline">' +
        '<img class="bl-cur" src="' + src('.shot-current') + '" alt="current"></div>';
    } else if (mode === 'sbs') {
      html = '<div class="thumbs">' + ['.shot-baseline', '.shot-current', '.shot-diff'].map(function (s, j) {
        return '<figure><figcaption style="color:#9a9a9a">' + ['Baseline', 'Current', 'Diff'][j] + '</figcaption>' +
          '<img src="' + src(s) + '" style="width:30vw" alt=""></figure>';
      }).join('') + '</div>';
    } else {
      html = '<div class="frame swipe-frame" style="width:' + w + ';--split:' + lbScrub.value + '%">' +
        '<img src="' + src('.shot-current') + '" alt="current">' +
        '<img class="sw-over" src="' + src('.shot-baseline') + '" alt="baseline">' +
        '<div class="handle" aria-hidden="true"></div></div>';
    }
    canvas.innerHTML = html;
    var lbBlink = canvas.querySelector('.blink-frame');
    if (lbBlink) lbBlink.addEventListener('click', function () { lbBlink.classList.toggle('showbase'); });
    apply();
    updateDots();
    updateTally();
  }
  function open(i) { lb.hidden = false; resetZoom(); show(i); }
  function close() { lb.hidden = true; }
  var openFirst = document.querySelector('[data-open-first]');
  if (openFirst) openFirst.addEventListener('click', function () { open(0); });
  cards.forEach(function (c, i) {
    var btn = c.querySelector('[data-open]');
    if (btn) btn.addEventListener('click', function () { open(i); });
  });
  lb.querySelector('.lb-close').addEventListener('click', close);
  lb.querySelector('.lb-nav.prev').addEventListener('click', function () { resetZoom(); show(idx - 1); });
  lb.querySelector('.lb-nav.next').addEventListener('click', function () { resetZoom(); show(idx + 1); });
  lb.querySelector('.lb-skip').addEventListener('click', nextUnreviewed);
  voteA.addEventListener('click', function () { vote(true); });
  voteR.addEventListener('click', function () { vote(false); });
  function copyCmd(done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmdInput.value).then(done, function () { cmdInput.select(); });
    } else {
      cmdInput.select();
    }
  }
  cmdbar.querySelector('.copy').addEventListener('click', function () {
    var btn = cmdbar.querySelector('.copy');
    copyCmd(function () { btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); });
  });
  var goBtn = cmdbar.querySelector('.go');
  if (goBtn) goBtn.addEventListener('click', function () {
    copyCmd(function () {});
    window.open(PR_URL + '#issue-comment-box', '_blank');
  });
  cmdbar.querySelector('.reset').addEventListener('click', function () {
    decisions = cards.map(function () { return null; });
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    updateAll();
  });
  lbScrub.addEventListener('input', function () {
    var f = canvas.querySelector('.swipe-frame');
    if (f) f.style.setProperty('--split', lbScrub.value + '%');
  });
  zoomWrap.addEventListener('wheel', function (e) {
    e.preventDefault();
    var next = Math.max(0.25, Math.min(8, scale * Math.exp(-e.deltaY * 0.0015)));
    scale = next; apply();
  }, { passive: false });
  zoomWrap.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.handle')) return;
    zoomWrap.classList.add('panning');
    zoomWrap.setPointerCapture(e.pointerId);
    var sx = e.clientX - tx, sy = e.clientY - ty;
    var move = function (ev) { tx = ev.clientX - sx; ty = ev.clientY - sy; apply(); };
    zoomWrap.addEventListener('pointermove', move);
    zoomWrap.addEventListener('pointerup', function up() {
      zoomWrap.classList.remove('panning');
      zoomWrap.removeEventListener('pointermove', move);
      zoomWrap.removeEventListener('pointerup', up);
    });
  });
  zoomWrap.addEventListener('dblclick', resetZoom);
  lb.querySelectorAll('.lb-bar .tab').forEach(function (tab) {
    tab.addEventListener('click', function () { mode = tab.dataset.mode; show(idx); });
  });
  document.addEventListener('dragstart', function (e) {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  });
  document.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (lb.hidden) {
      if (e.key === 'j' || e.key === 'J') scrollToCard(1);
      else if (e.key === 'k' || e.key === 'K') scrollToCard(-1);
      return;
    }
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J') { resetZoom(); show(idx + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'K') { resetZoom(); show(idx - 1); }
    else if (e.key === 's' || e.key === 'S') { mode = 'swipe'; show(idx); }
    else if (e.key === 'o' || e.key === 'O') { mode = 'overlay'; show(idx); }
    else if (e.key === 'b' || e.key === 'B') { mode = 'blink'; show(idx); }
    else if (e.key === 'd' || e.key === 'D') { mode = 'sbs'; show(idx); }
    else if (e.key === 'a' || e.key === 'A') { vote(true); }
    else if (e.key === 'r' || e.key === 'R') { vote(false); }
    else if (e.key === 'u' || e.key === 'U') { nextUnreviewed(); }
  });

  loadDecisions();
  buildDots();
  updateAll();
})();
</script>
</body>
</html>`;
}
