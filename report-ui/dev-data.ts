// Fixture for `npm run dev:ui` only — never bundled into the production template.
import type { ReportData, ReportItem } from '../src/report-data';

function screen(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f8fafc';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#0f172a';
  g.fillRect(0, 0, w, 56);
  draw(g);
  return c.toDataURL('image/png');
}

function cards(g: CanvasRenderingContext2D, accent: string, offset = 0) {
  for (let i = 0; i < 3; i++) {
    g.fillStyle = '#fff';
    g.fillRect(32 + i * 250, 96 + offset, 220, 160);
    g.fillStyle = accent;
    g.fillRect(48 + i * 250, 112 + offset, 120, 16);
  }
}

function mask(w: number, h: number, x: number, y: number, mw: number, mh: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,0,128,0.9)';
  g.fillRect(x, y, mw, mh);
  return c.toDataURL('image/png');
}

export function makeDevData(): ReportData {
  const W = 800;
  const H = 480;
  const base = screen(W, H, (g) => cards(g, '#2563eb'));
  const cur = screen(W, H, (g) => cards(g, '#db2777', 12));
  const items: ReportItem[] = [
    { name: 'home.png', status: 'changed', diffRatio: 0.0731, approved: false, baseline: base, current: cur, diff: mask(W, H, 32, 96, 720, 180), mask: mask(W, H, 32, 96, 720, 180) },
    { name: 'settings/profile.png', status: 'changed', diffRatio: 0.0042, approved: true, baseline: base, current: base, diff: mask(W, H, 40, 120, 60, 20), mask: mask(W, H, 40, 120, 60, 20) },
    { name: 'nav/menu.png', status: 'added', diffRatio: 0, approved: false, current: cur },
    { name: 'legacy/old banner.png', status: 'removed', diffRatio: 0, approved: false, baseline: base },
    { name: 'footer.png', status: 'unchanged', diffRatio: 0, approved: false },
  ];
  return {
    version: 1,
    repo: 'Fiestaboard/demo',
    runUrl: 'https://github.com/Fiestaboard/demo/actions/runs/1',
    sha: 'abc1234def5678abc1234def5678abc1234def56',
    pin: 'abc1234',
    baselineRunUrl: 'https://github.com/Fiestaboard/demo/actions/runs/0',
    missingBaseline: false,
    prUrl: 'https://github.com/Fiestaboard/demo/pull/7',
    items,
  };
}
