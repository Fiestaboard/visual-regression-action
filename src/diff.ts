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
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: opts.threshold,
  });
  const ratio = mismatched / (width * height);
  const changed = dimsMismatch || ratio > opts.diffRatio;
  return {
    name,
    status: changed ? 'changed' : 'unchanged',
    diffRatio: ratio,
    baselinePng: changed ? baselineBuf : undefined,
    currentPng: changed ? currentBuf : undefined,
    diffPng: changed ? PNG.sync.write(diff) : undefined,
  };
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
