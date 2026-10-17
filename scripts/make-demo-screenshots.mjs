// Draws small fake "UI screens" as PNGs for the visual-demo workflow.
// Real projects capture screenshots from their actual app (Playwright,
// Storybook, ...) — this script exists so the demo needs no app at all,
// and so a reviewable one-line code change produces a visible diff.
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const W = 320;
const H = 200;

const WHITE = [255, 255, 255, 255];
const BLUE = [59, 130, 246, 255];
const GREEN = [34, 197, 94, 255];
const GRAY = [148, 163, 184, 255];
const ORANGE = [249, 115, 22, 255];
const SLATE = [226, 232, 240, 255];

// Each entry becomes demo-screens/<name>. Tweak a value in a PR and the
// visual-demo workflow will flag exactly that screen as changed.
const SCREENS = {
  'home.png': { header: BLUE, rows: 4, accent: GREEN },
  'settings.png': { header: BLUE, rows: 6, accent: GRAY },
  'profile.png': { header: BLUE, rows: 3, accent: ORANGE },
};

function rect(img, x, y, w, h, [r, g, b, a]) {
  for (let yy = y; yy < y + h && yy < H; yy++) {
    for (let xx = x; xx < x + w && xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
    }
  }
}

function drawScreen({ header, rows, accent }) {
  const img = new PNG({ width: W, height: H });
  rect(img, 0, 0, W, H, WHITE);
  rect(img, 0, 0, W, 36, header);            // header bar
  rect(img, 12, 10, 60, 16, WHITE);          // logo block
  for (let i = 0; i < rows; i++) {           // content rows
    rect(img, 16, 52 + i * 22, W - 96, 12, SLATE);
  }
  rect(img, W - 68, 52, 52, 24, accent);     // accent button
  return PNG.sync.write(img);
}

const out = 'demo-screens';
mkdirSync(out, { recursive: true });
for (const [name, spec] of Object.entries(SCREENS)) {
  writeFileSync(join(out, name), drawScreen(spec));
}
console.log(`wrote ${Object.keys(SCREENS).length} screens to ${out}/`);
