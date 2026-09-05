import { CompareSummary, ScreenshotResult } from './types';

export interface ReportMeta {
  repo: string;
  runUrl: string;
  sha: string;
  baselineRunUrl?: string;
  missingBaseline: boolean;
  reportArtifactName: string;
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
      lines.push(`| ${STATUS_LABEL[r.status]} | \`${escPipe(r.name)}\` | ${diff} |`);
    }
    const hidden = summary.results.filter((r) => r.status !== 'unchanged').length - notable.length;
    if (hidden > 0) lines.push('', `…and ${hidden} more.`);
    lines.push('');
  }

  lines.push(`📦 [Download the full visual report](${meta.runUrl}) (run artifact \`${meta.reportArtifactName}\`)`);
  if (meta.baselineRunUrl) lines.push('', `Baseline from [this run](${meta.baselineRunUrl}) · commit \`${meta.sha.slice(0, 7)}\``);
  return lines.join('\n');
}

function card(r: ScreenshotResult): string {
  const imgs =
    r.status === 'changed'
      ? `
    <div class="compare" style="--split:50%">
      <div class="pane"><h4>Baseline</h4><img class="shot-baseline" src="${dataUri(r.baselinePng)}" alt="baseline"></div>
      <div class="pane"><h4>Current</h4><img class="shot-current" src="${dataUri(r.currentPng)}" alt="current"></div>
      <div class="pane"><h4>Diff (${pct(r.diffRatio)})</h4><img src="${dataUri(r.diffPng)}" alt="diff"></div>
    </div>
    <div class="slider">
      <h4>Swipe</h4>
      <div class="overlay">
        <img class="under" alt="baseline">
        <img class="over" alt="current">
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
  <div class="meta">${esc(meta.repo)} · commit ${esc(meta.sha.slice(0, 7))} · <a href="${esc(meta.runUrl)}">workflow run</a>${
    meta.baselineRunUrl ? ` · baseline from <a href="${esc(meta.baselineRunUrl)}">this run</a>` : ''
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
// Swipe-slider overlay images reuse the pane images' already-embedded data URIs
// instead of re-embedding each PNG a second time in the document.
for (const card of document.querySelectorAll('.card[data-status="changed"]')) {
  const baseline = card.querySelector('.shot-baseline');
  const current = card.querySelector('.shot-current');
  const under = card.querySelector('.overlay .under');
  const over = card.querySelector('.overlay .over');
  if (baseline && under) under.src = baseline.src;
  if (current && over) over.src = current.src;
}
</script>
</body>
</html>`;
}
