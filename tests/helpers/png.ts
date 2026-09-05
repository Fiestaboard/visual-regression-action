import { PNG } from 'pngjs';

export type RGBA = [number, number, number, number];

export function makePng(width: number, height: number, rgba: RGBA): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

export function makePngWithRect(
  width: number,
  height: number,
  bg: RGBA,
  rect: { x: number; y: number; w: number; h: number; color: RGBA }
): Buffer {
  const png = PNG.sync.read(makePng(width, height, bg));
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * width + x) * 4;
      png.data[i] = rect.color[0];
      png.data[i + 1] = rect.color[1];
      png.data[i + 2] = rect.color[2];
      png.data[i + 3] = rect.color[3];
    }
  }
  return PNG.sync.write(png);
}
