import { CompareSummary, ScreenshotResult, Status } from './types';
import { shortHash } from './approvals';

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
    const entries = unapproved
      .filter((r) => !/\s/.test(r.name))
      .slice(0, 30)
      .map((r) => {
        const buf = r.status === 'changed' ? r.currentPng : r.baselinePng;
        return buf ? `${r.name}@${shortHash(buf)}` : '';
      })
      .filter(Boolean);
    lines.push(
      '<details>',
      '<summary>✅ <b>Accept these changes</b> — copy a command, post it as a comment</summary>',
      '',
      'If the changes are intentional, post one of these as a PR comment. ' +
        'With the [approvals workflow](https://github.com/Fiestaboard/visual-regression-action#approving-changes) installed, ' +
        'the check reruns and passes automatically; otherwise use "Re-run failed jobs" after posting.',
      '',
      'Approve everything (valid until the next push):',
      '',
      '```',
      '/vrt approve all',
      '```',
      '',
      `Or pinned to exactly this commit: \`/vrt approve all@${meta.sha.slice(0, 7)}\``
    );
    if (entries.length > 0) {
      lines.push('', 'Or approve screenshots individually (edit to taste):', '', '```', `/vrt approve ${entries.join(' ')}`, '```');
    }
    lines.push('', '</details>', '');
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

// Each PNG is embedded exactly once: the side-by-side thumbnails carry the
// baseline/current/diff data URIs, the overlay carries the mask. Every other
// <img> (swipe views, the fullscreen reviewer) is populated at load by
// copying those srcs — see the inline script.
function changedCard(r: ScreenshotResult): string {
  const hash = r.currentPng ? shortHash(r.currentPng) : '';
  return `
  <section class="card" data-status="changed"${hash ? ` data-hash="${hash}"` : ''}>
    <header>
      <span class="badge changed">${STATUS_LABEL.changed}</span>
      <h3>${esc(r.name)}</h3>
      ${r.approved ? '<span class="okchip">✓ approved</span>' : ''}
      <span class="stat">${pct(r.diffRatio)}</span>
      <button class="expand" data-open type="button">Expand ⤢</button>
    </header>
    <div class="stage" data-mode="swipe">
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" aria-selected="true" data-mode="swipe" type="button">Swipe</button>
        <button class="tab" role="tab" aria-selected="false" data-mode="overlay" type="button">Overlay</button>
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
        <div class="frame">
          <img class="ov-cur" alt="current">
          <img class="ov-mask" src="${dataUri(r.diffMaskPng)}" alt="changed pixels highlighted">
        </div>
        <p class="legend">current screenshot · detected changes in pink</p>
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

function simpleCard(r: ScreenshotResult): string {
  const img =
    r.status === 'added'
      ? `<img class="shot-current" src="${dataUri(r.currentPng)}" alt="current (new)">`
      : `<img class="shot-baseline" src="${dataUri(r.baselinePng)}" alt="baseline (removed)">`;
  const caption = r.status === 'added' ? 'Current (new)' : 'Baseline (removed)';
  const hash = r.status === 'removed' && r.baselinePng ? shortHash(r.baselinePng) : '';
  return `
  <section class="card" data-status="${r.status}"${hash ? ` data-hash="${hash}"` : ''}>
    <header>
      <span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span>
      <h3>${esc(r.name)}</h3>
      ${r.approved ? '<span class="okchip">✓ approved</span>' : ''}
      <button class="expand" data-open type="button">Expand ⤢</button>
    </header>
    <div class="single"><figure><figcaption>${caption}</figcaption>${img}</figure></div>
  </section>`;
}

function unchangedCard(r: ScreenshotResult): string {
  return `
  <section class="card slim" data-status="unchanged">
    <header>
      <span class="badge unchanged">${STATUS_LABEL.unchanged}</span>
      <h3>${esc(r.name)}</h3>
    </header>
  </section>`;
}

function card(r: ScreenshotResult): string {
  if (r.status === 'changed') return changedCard(r);
  if (r.status === 'unchanged') return unchangedCard(r);
  return simpleCard(r);
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
  .top { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line);
    padding:16px 24px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; z-index:2 }
  .top h1 { font-size:18px; margin:0 auto 0 0 }
  .top .meta { color:var(--muted); font-size:13px; width:100% }
  button { font:inherit; color:var(--fg); cursor:pointer }
  button.filter { border:1px solid var(--line); background:var(--card);
    border-radius:999px; padding:4px 14px; font-size:13px }
  button.filter[aria-pressed="true"] { outline:2px solid var(--fg) }
  button.review { border:0; background:var(--hot); color:#fff; border-radius:999px;
    padding:6px 18px; font-size:13px; font-weight:600 }
  main { max-width:1100px; margin:0 auto; padding:24px }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:20px; margin-bottom:24px }
  .card.slim { padding:12px 20px }
  .card.hidden { display:none }
  .card header { display:flex; gap:10px; align-items:center }
  .card:not(.slim) header { margin-bottom:14px }
  .card h3 { margin:0 auto 0 0; font-size:15px; font-family:ui-monospace,Menlo,monospace; word-break:break-all }
  .stat { font-family:ui-monospace,Menlo,monospace; font-size:13px; color:var(--changed);
    font-variant-numeric:tabular-nums }
  .badge { border-radius:999px; padding:2px 10px; font-size:12px; font-weight:600; white-space:nowrap }
  .badge.changed { background:var(--changed-bg); color:var(--changed) }
  .badge.added { background:var(--added-bg); color:var(--added) }
  .badge.removed { background:var(--removed-bg); color:var(--removed) }
  .badge.unchanged { background:var(--unchanged-bg); color:var(--unchanged) }
  button.expand { border:1px solid var(--line); background:transparent; border-radius:8px;
    padding:4px 10px; font-size:12px; white-space:nowrap }
  .tabs { display:flex; gap:4px; margin-bottom:10px }
  .tab { border:1px solid var(--line); background:transparent; border-radius:8px;
    padding:4px 12px; font-size:13px }
  .tab[aria-selected="true"] { background:var(--fg); color:var(--bg); border-color:var(--fg) }
  .stage .view { display:none }
  .stage[data-mode="swipe"] .view-swipe { display:block }
  .stage[data-mode="overlay"] .view-overlay { display:block }
  .stage[data-mode="sbs"] .view-sbs { display:block }
  .frame { position:relative; border:1px solid var(--line); border-radius:8px; overflow:hidden;
    background:#fff; line-height:0 }
  /* Comparison surfaces are drag targets — text/image selection there is noise. */
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
  .lightbox { position:fixed; inset:0; z-index:10; background:#0b0b0e;
    color:#e8e8e8; display:flex; flex-direction:column }
  .lightbox[hidden] { display:none }
  .lb-bar { display:flex; gap:14px; align-items:center; padding:12px 20px; flex-wrap:wrap }
  .lb-name { font-family:ui-monospace,Menlo,monospace; font-size:14px; word-break:break-all }
  .lb-count { font-variant-numeric:tabular-nums; color:#9a9a9a; font-size:13px }
  .lb-stat { color:var(--hot); font-family:ui-monospace,Menlo,monospace; font-size:13px }
  .lb-bar .tabs { margin:0 0 0 auto }
  .lightbox .tab { border-color:#3a3d44; color:#e8e8e8 }
  .lightbox .tab[aria-selected="true"] { background:#e8e8e8; color:#111; border-color:#e8e8e8 }
  button.lb-close { border:1px solid #3a3d44; background:transparent; color:#e8e8e8;
    border-radius:8px; padding:4px 12px; font-size:13px }
  .okchip { border-radius:999px; padding:2px 10px; font-size:12px; font-weight:600;
    background:var(--unchanged-bg); color:var(--unchanged); white-space:nowrap }
  button.vote { border:1px solid #3a3d44; background:transparent; color:#e8e8e8;
    border-radius:8px; padding:4px 12px; font-size:13px }
  button.vote.approve[aria-pressed="true"] { background:#15803d; border-color:#15803d; color:#fff }
  button.vote.reject[aria-pressed="true"] { background:#b91c1c; border-color:#b91c1c; color:#fff }
  .lb-tally { color:#9a9a9a; font-size:13px; font-variant-numeric:tabular-nums }
  .cmdbar { position:fixed; left:0; right:0; bottom:0; z-index:12; display:flex; gap:10px;
    align-items:center; flex-wrap:wrap; padding:12px 20px; background:var(--card);
    border-top:2px solid var(--hot); box-shadow:0 -4px 16px rgba(0,0,0,.15) }
  .cmdbar[hidden] { display:none }
  .cmdbar.partial { border-top-color:var(--warn) }
  .cmdbar .coverage { font-size:13px; color:var(--muted); flex:1 1 100% }
  .cmdbar.partial .coverage { color:var(--warn); font-weight:600 }
  .cmdbar input { flex:1 1 320px; min-width:0; font:13px ui-monospace,Menlo,monospace;
    padding:8px 10px; border:1px solid var(--line); border-radius:8px;
    background:var(--bg); color:var(--fg) }
  .cmdbar .copy, .cmdbar a.pr { border:0; background:var(--hot); color:#fff; border-radius:8px;
    padding:8px 16px; font-size:13px; font-weight:600; text-decoration:none; white-space:nowrap }
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
  @media (prefers-reduced-motion: reduce) { * { transition:none !important } }
</style>
</head>
<body>
<div class="top">
  <h1>🎨 Visual regression report</h1>
  ${reviewable > 0 ? `<button class="review" data-open-first type="button">Review ${reviewable} change${reviewable === 1 ? '' : 's'}</button>` : ''}
  ${counts
    .map(
      ([k, n]) =>
        `<button class="filter" aria-pressed="true" data-status="${k}" type="button">${STATUS_LABEL[k]} · ${n}</button>`
    )
    .join('\n  ')}
  <div class="meta">${esc(meta.repo)} · commit ${esc(meta.sha.slice(0, 7))} · <a href="${esc(meta.runUrl)}">workflow run</a>${
    meta.baselineRunUrl ? ` · baseline from <a href="${esc(meta.baselineRunUrl)}">this run</a>` : ''
  }${meta.missingBaseline ? ' · ⚠️ no baseline found — everything is new' : ''}</div>
</div>
<main>
${ordered.map(card).join('\n')}
</main>
<div class="lightbox" hidden>
  <div class="lb-bar">
    <span class="lb-count"></span>
    <span class="lb-name"></span>
    <span class="lb-stat"></span>
    <button class="vote approve" type="button" aria-pressed="false">Approve <kbd>A</kbd></button>
    <button class="vote reject" type="button" aria-pressed="false">Reject <kbd>R</kbd></button>
    <span class="lb-tally"></span>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-mode="swipe" type="button">Swipe <kbd>S</kbd></button>
      <button class="tab" role="tab" data-mode="overlay" type="button">Overlay <kbd>O</kbd></button>
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
    <span>scroll to zoom · drag to pan · double-click resets</span>
  </div>
</div>
<div class="cmdbar" hidden>
  <span class="coverage"></span>
  <input class="cmd" readonly aria-label="approval command">
  <button class="copy" type="button">Copy</button>
  ${meta.prUrl ? `<a class="pr" href="${esc(meta.prUrl)}">Open PR ↗</a>` : ''}
</div>
<script>
(function () {
  'use strict';
  // --- filters ---
  document.querySelectorAll('button.filter').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      document.querySelectorAll('.card[data-status="' + btn.dataset.status + '"]').forEach(function (c) {
        c.classList.toggle('hidden', !on);
      });
    });
  });

  // --- per-card wiring: copy embedded srcs, tabs, swipe scrub ---
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card:not([data-status="unchanged"])'));
  cards.forEach(function (c) {
    var b = c.querySelector('.shot-baseline'), cur = c.querySelector('.shot-current');
    var under = c.querySelector('.sw-under'), over = c.querySelector('.sw-over'), ovc = c.querySelector('.ov-cur');
    // The clipped top layer shows LEFT of the split line — that side is the baseline.
    if (cur && under) under.src = cur.src;
    if (b && over) over.src = b.src;
    if (cur && ovc) ovc.src = cur.src;
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
  });
  function setMode(stage, mode, scope) {
    if (!stage) return;
    stage.setAttribute('data-mode', mode);
    scope.querySelectorAll('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', String(t.dataset.mode === mode));
    });
  }

  // --- fullscreen reviewer ---
  var lb = document.querySelector('.lightbox');
  var canvas = lb.querySelector('.lb-canvas');
  var zoomWrap = lb.querySelector('.lb-zoom');
  var lbScrub = lb.querySelector('.lb-foot .scrub');
  var idx = 0, scale = 1, tx = 0, ty = 0, mode = 'swipe';
  var decisions = cards.map(function () { return null; });
  var voteA = lb.querySelector('.vote.approve');
  var voteR = lb.querySelector('.vote.reject');
  var cmdbar = document.querySelector('.cmdbar');
  var cmdInput = cmdbar.querySelector('.cmd');
  function votableCards() {
    return cards.filter(function (c) { return c.getAttribute('data-hash'); });
  }
  function updateTally() {
    var total = votableCards().length;
    var yes = 0, no = 0;
    cards.forEach(function (c, i) {
      if (!c.getAttribute('data-hash')) return;
      if (decisions[i] === true) yes++;
      if (decisions[i] === false) no++;
    });
    lb.querySelector('.lb-tally').textContent =
      total ? yes + ' approved · ' + no + ' rejected · ' + (total - yes - no) + ' left' : '';
  }
  function updateCmdbar() {
    var entries = [], total = 0, rejected = 0;
    cards.forEach(function (c, i) {
      var h = c.getAttribute('data-hash');
      if (!h) return;
      total++;
      if (decisions[i] === true) entries.push(c.querySelector('h3').textContent + '@' + h);
      if (decisions[i] === false) rejected++;
    });
    cmdbar.hidden = entries.length === 0;
    if (!entries.length) return;
    cmdInput.value = '/vrt approve ' + entries.join(' ');
    var unreviewed = total - entries.length - rejected;
    var cov = cmdbar.querySelector('.coverage');
    if (unreviewed > 0) {
      cov.textContent = '⚠️ Covers ' + entries.length + ' of ' + total + ' — ' + unreviewed +
        ' still unreviewed. The check stays red until every changed/removed screenshot is approved.';
      cmdbar.classList.add('partial');
    } else if (rejected > 0) {
      cov.textContent = 'Covers ' + entries.length + ' of ' + total + ' — ' + rejected +
        ' rejected (check stays red until those are fixed). Post as a PR comment:';
      cmdbar.classList.remove('partial');
    } else {
      cov.textContent = 'Covers all ' + total + ' changes — post as a PR comment and the check will pass:';
      cmdbar.classList.remove('partial');
    }
  }
  function vote(v) {
    if (!cards[idx].getAttribute('data-hash')) return;
    decisions[idx] = decisions[idx] === v ? null : v;
    updateCmdbar();
    resetZoom();
    show(decisions[idx] === null ? idx : idx + 1);
  }
  function apply() {
    canvas.style.transform = 'translate(-50%,-50%) translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }
  function resetZoom() { scale = 1; tx = 0; ty = 0; apply(); }
  function show(i) {
    idx = (i + cards.length) % cards.length;
    var c = cards[idx];
    var status = c.getAttribute('data-status');
    lb.querySelector('.lb-count').textContent = (idx + 1) + ' / ' + cards.length;
    lb.querySelector('.lb-name').textContent = c.querySelector('h3').textContent;
    var stat = c.querySelector('.stat');
    lb.querySelector('.lb-stat').textContent = stat ? stat.textContent + ' changed' : (status === 'added' ? 'new screenshot' : 'removed screenshot');
    var changed = status === 'changed';
    lb.querySelectorAll('.lb-bar .tab').forEach(function (t) {
      t.style.display = changed ? '' : 'none';
      t.setAttribute('aria-selected', String(changed && t.dataset.mode === mode));
    });
    lbScrub.style.display = changed && mode === 'swipe' ? '' : 'none';
    var votable = !!c.getAttribute('data-hash');
    voteA.style.display = votable ? '' : 'none';
    voteR.style.display = votable ? '' : 'none';
    voteA.setAttribute('aria-pressed', String(decisions[idx] === true));
    voteR.setAttribute('aria-pressed', String(decisions[idx] === false));
    updateTally();
    var src = function (sel) { var el = c.querySelector(sel); return el ? el.src : ''; };
    var w = 'min(88vw, 1400px)';
    var html;
    if (!changed) {
      html = '<div class="frame" style="width:' + w + '"><img src="' + src('.single img') + '" alt=""></div>';
    } else if (mode === 'overlay') {
      html = '<div class="frame" style="width:' + w + '"><img src="' + src('.shot-current') + '" alt="current">' +
        '<img class="ov-mask" src="' + src('.ov-mask') + '" alt="changed pixels"></div>';
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
    apply();
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
  voteA.addEventListener('click', function () { vote(true); });
  voteR.addEventListener('click', function () { vote(false); });
  cmdbar.querySelector('.copy').addEventListener('click', function () {
    var btn = cmdbar.querySelector('.copy');
    var done = function () { btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmdInput.value).then(done, function () { cmdInput.select(); });
    } else {
      cmdInput.select();
    }
  });
  document.addEventListener('dragstart', function (e) {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  });
  lb.querySelectorAll('.lb-bar .tab').forEach(function (tab) {
    tab.addEventListener('click', function () { mode = tab.dataset.mode; show(idx); });
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
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') { resetZoom(); show(idx + 1); }
    else if (e.key === 'ArrowLeft') { resetZoom(); show(idx - 1); }
    else if (e.key === 's' || e.key === 'S') { mode = 'swipe'; show(idx); }
    else if (e.key === 'o' || e.key === 'O') { mode = 'overlay'; show(idx); }
    else if (e.key === 'd' || e.key === 'D') { mode = 'sbs'; show(idx); }
    else if (e.key === 'a' || e.key === 'A') { vote(true); }
    else if (e.key === 'r' || e.key === 'R') { vote(false); }
  });
})();
</script>
</body>
</html>`;
}
