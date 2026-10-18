import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareDirectories } from '../../src/diff';
import { diffRasters, MASK_COLOR, onCanvas, type Raster } from './diff-core';

function raster(width: number, height: number, fill: [number, number, number, number], rect?: { x: number; y: number; w: number; h: number; c: [number, number, number, number] }): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inRect = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      data.set(inRect ? rect.c : fill, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const toPng = (r: Raster) => {
  const p = new PNG({ width: r.width, height: r.height });
  p.data = Buffer.from(r.data);
  return PNG.sync.write(p);
};

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const RED: [number, number, number, number] = [255, 0, 0, 255];

describe('diffRasters', () => {
  it('highlights exactly the changed pixels, in the overlay colour, transparent elsewhere', () => {
    const { mask, mismatched } = diffRasters(raster(20, 20, WHITE), raster(20, 20, WHITE, { x: 5, y: 5, w: 4, h: 4, c: RED }), 0.1);
    expect(mismatched).toBe(16);
    const at = (x: number, y: number) => [...mask.data.subarray((y * 20 + x) * 4, (y * 20 + x) * 4 + 4)];
    expect(at(6, 6)).toEqual([...MASK_COLOR, 255]);
    expect(at(0, 0)[3]).toBe(0);
  });

  it('pads differently sized screenshots top-left, as the action does', () => {
    const small = raster(2, 2, RED);
    const padded = onCanvas(small, 3, 3);
    expect([...padded.data.subarray(0, 4)]).toEqual(RED);
    expect([...padded.data.subarray((2 * 3 + 2) * 4, (2 * 3 + 2) * 4 + 4)]).toEqual([0, 0, 0, 0]);
    expect(diffRasters(small, raster(3, 3, RED), 0.1).diff.width).toBe(3);
  });

  it('agrees with the action on how much changed', () => {
    const base = raster(60, 40, WHITE);
    const cur = raster(60, 40, WHITE, { x: 10, y: 10, w: 20, h: 5, c: [250, 240, 240, 255] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrt-ui-'));
    fs.mkdirSync(path.join(dir, 'b'));
    fs.mkdirSync(path.join(dir, 'c'));
    fs.writeFileSync(path.join(dir, 'b', 'x.png'), toPng(base));
    fs.writeFileSync(path.join(dir, 'c', 'x.png'), toPng(cur));
    for (const threshold of [0.01, 0.1, 0.5]) {
      const action = compareDirectories(path.join(dir, 'b'), path.join(dir, 'c'), { threshold, diffRatio: 0 }).results[0];
      const browser = diffRasters(base, cur, threshold);
      expect(browser.mismatched / (60 * 40)).toBeCloseTo(action.diffRatio, 10);
    }
  });
});
