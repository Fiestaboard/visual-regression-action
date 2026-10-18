// The diff the report draws, computed in the browser from baseline and
// current. It mirrors src/diff.ts in the action — same pixelmatch, same
// threshold, same top-left padding when the sizes differ — so the pixels it
// highlights are the ones the action counted. Pure: runs in the diff worker,
// on the main thread as a fallback, and in unit tests.
import pixelmatch from 'pixelmatch';

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** The overlay colour for changed pixels (matches the action's former mask). */
export const MASK_COLOR: [number, number, number] = [236, 72, 153];

/** Copy `src` into the top-left of a transparent canvas of the given size. */
export function onCanvas(src: Raster, width: number, height: number): Raster {
  if (src.width === width && src.height === height) return src;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < src.height; y++) {
    data.set(src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4), y * width * 4);
  }
  return { width, height, data };
}

export interface DiffRasters {
  /** pixelmatch's default output: the current image faded, changes in red. */
  diff: Raster;
  /** Only the changed pixels, in MASK_COLOR; transparent elsewhere. */
  mask: Raster;
  mismatched: number;
}

export function diffRasters(baseline: Raster, current: Raster, threshold: number): DiffRasters {
  const width = Math.max(baseline.width, current.width);
  const height = Math.max(baseline.height, current.height);
  const a = onCanvas(baseline, width, height);
  const b = onCanvas(current, width, height);
  const diff = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8ClampedArray(width * height * 4);
  const mismatched = pixelmatch(a.data, b.data, diff, width, height, { threshold });
  pixelmatch(a.data, b.data, mask, width, height, { threshold, diffMask: true, diffColor: MASK_COLOR });
  return { diff: { width, height, data: diff }, mask: { width, height, data: mask }, mismatched };
}
