import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { makePng, makePngWithRect } from './png';

describe('png helpers', () => {
  it('makePng produces a decodable PNG of the right size and color', () => {
    const buf = makePng(4, 3, [255, 0, 0, 255]);
    const png = PNG.sync.read(buf);
    expect(png.width).toBe(4);
    expect(png.height).toBe(3);
    expect([...png.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it('makePngWithRect paints the rect color inside and bg outside', () => {
    const buf = makePngWithRect(10, 10, [0, 0, 255, 255], { x: 2, y: 2, w: 3, h: 3, color: [0, 255, 0, 255] });
    const png = PNG.sync.read(buf);
    const px = (x: number, y: number) => [...png.data.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 4)];
    expect(px(0, 0)).toEqual([0, 0, 255, 255]);
    expect(px(3, 3)).toEqual([0, 255, 0, 255]);
  });
});
