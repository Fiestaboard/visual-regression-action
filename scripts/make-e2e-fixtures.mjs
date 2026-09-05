// Generates PNG fixture directories for the e2e dogfood job.
// base/:    same.png, changed.png, removed.png
// changed/: same.png, changed.png (differs), added.png
// Expected compare result: 1 changed, 1 added, 1 removed, 1 unchanged.
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

function png(width, height, [r, g, b, a], rect) {
  const img = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
  }
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = (y * width + x) * 4;
        img.data[i] = rect.color[0]; img.data[i + 1] = rect.color[1];
        img.data[i + 2] = rect.color[2]; img.data[i + 3] = rect.color[3];
      }
    }
  }
  return PNG.sync.write(img);
}

const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];
const base = 'e2e-tmp/base';
const changed = 'e2e-tmp/changed';
mkdirSync(base, { recursive: true });
mkdirSync(changed, { recursive: true });

writeFileSync(join(base, 'same.png'), png(100, 100, WHITE));
writeFileSync(join(changed, 'same.png'), png(100, 100, WHITE));
writeFileSync(join(base, 'changed.png'), png(100, 100, WHITE));
writeFileSync(join(changed, 'changed.png'), png(100, 100, WHITE, { x: 10, y: 10, w: 30, h: 30, color: RED }));
writeFileSync(join(base, 'removed.png'), png(100, 100, WHITE));
writeFileSync(join(changed, 'added.png'), png(100, 100, RED));
console.log('e2e fixtures written to e2e-tmp/');
