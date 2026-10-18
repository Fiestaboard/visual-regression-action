import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { CompareSummary, ScreenshotResult } from './types';

type PNGImage = { width: number; height: number; data: Buffer };

export function listPngs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relPath);
      else if (entry.name.toLowerCase().endsWith('.png')) out.push(relPath);
    }
  };
  walk('');
  return out.sort();
}

/** Copy `src` into the top-left of a canvas of the given dimensions. */
function onCanvas(src: PNGImage, width: number, height: number): PNG {
  const canvas = new PNG({ width, height });
  for (let y = 0; y < src.height; y++) {
    src.data.copy(canvas.data, (y * width) * 4, (y * src.width) * 4, (y * src.width + src.width) * 4);
  }
  return canvas;
}

/** Rows kept above and below a local change, for context. */
export const CROP_MARGIN = 200;
/** Crop only when the band is at most this share of the page… */
export const CROP_MAX_SHARE = 0.6;
/** …and saves at least this many rows. */
export const CROP_MIN_SAVING = 400;

/** First and last row (inclusive) holding any drawn pixel of a diffMask output, or null. */
function changedRows(mask: Buffer, width: number, height: number): [number, number] | null {
  let first = -1;
  let last = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (mask[row + x * 4 + 3] !== 0) {
        if (first < 0) first = y;
        last = y;
        break;
      }
    }
  }
  return first < 0 ? null : [first, last];
}

/** Rows [top, top + height) of an RGBA image, as a PNG. */
function cropRows(img: PNGImage, top: number, height: number): Buffer {
  const out = new PNG({ width: img.width, height });
  img.data.copy(out.data, 0, top * img.width * 4, (top + height) * img.width * 4);
  return PNG.sync.write(out);
}

/**
 * The band the report should show for a change between `first` and `last`,
 * or null when the change spans enough of the page that the whole of it
 * should ship.
 */
export function cropBand(first: number, last: number, height: number): { top: number; height: number } | null {
  const top = Math.max(0, first - CROP_MARGIN);
  const bottom = Math.min(height, last + 1 + CROP_MARGIN);
  const band = bottom - top;
  if (band > height * CROP_MAX_SHARE || height - band < CROP_MIN_SAVING) return null;
  return { top, height: band };
}

function compareOne(
  name: string,
  baselineBuf: Buffer,
  currentBuf: Buffer,
  opts: { threshold: number; diffRatio: number }
): ScreenshotResult {
  let a: PNGImage = PNG.sync.read(baselineBuf);
  let b: PNGImage = PNG.sync.read(currentBuf);
  const dimsMismatch = a.width !== b.width || a.height !== b.height;
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  if (dimsMismatch) {
    a = onCanvas(a, width, height);
    b = onCanvas(b, width, height);
  }
  // One pass, drawing only the changed pixels: it gives the count, and the
  // rows they sit on. The report draws its own diff and overlay in the
  // browser from baseline and current, so neither is encoded here.
  const mask = Buffer.alloc(width * height * 4);
  const mismatched = pixelmatch(a.data, b.data, mask, width, height, {
    threshold: opts.threshold,
    diffMask: true,
  });
  const ratio = mismatched / (width * height);
  const changed = dimsMismatch || ratio > opts.diffRatio;
  if (!changed) return { name, status: 'unchanged', diffRatio: ratio };

  const result: ScreenshotResult = { name, status: 'changed', diffRatio: ratio, baselinePng: baselineBuf, currentPng: currentBuf };
  // A page whose size changed shifts as a whole; ship all of it.
  const rows = dimsMismatch ? null : changedRows(mask, width, height);
  const band = rows ? cropBand(rows[0], rows[1], height) : null;
  if (band) {
    result.crop = { ...band, baselinePng: cropRows(a, band.top, band.height), currentPng: cropRows(b, band.top, band.height) };
  }
  return result;
}

export function compareDirectories(
  baselineDir: string,
  currentDir: string,
  opts: { threshold: number; diffRatio: number }
): CompareSummary {
  const baseNames = new Set(listPngs(baselineDir));
  const currNames = new Set(listPngs(currentDir));
  const allNames = [...new Set([...baseNames, ...currNames])].sort();

  const results: ScreenshotResult[] = allNames.map((name) => {
    const inBase = baseNames.has(name);
    const inCurr = currNames.has(name);
    if (inBase && inCurr) {
      return compareOne(
        name,
        fs.readFileSync(path.join(baselineDir, name)),
        fs.readFileSync(path.join(currentDir, name)),
        opts
      );
    }
    if (inCurr) {
      return { name, status: 'added', diffRatio: 0, currentPng: fs.readFileSync(path.join(currentDir, name)) };
    }
    return { name, status: 'removed', diffRatio: 0, baselinePng: fs.readFileSync(path.join(baselineDir, name)) };
  });

  const count = (s: string): number => results.filter((r) => r.status === s).length;
  const changed = count('changed');
  const removed = count('removed');
  return {
    results,
    changed,
    added: count('added'),
    removed,
    unchanged: count('unchanged'),
    hasChanges: changed + removed > 0,
  };
}
