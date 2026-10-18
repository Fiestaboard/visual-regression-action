import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { compareDirectories, listPngs, cropBand, CROP_MARGIN } from '../src/diff';
import { makePng, makePngWithRect } from './helpers/png';

function tmpDirs(): { base: string; curr: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vrt-'));
  const base = path.join(root, 'base');
  const curr = path.join(root, 'curr');
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(curr, { recursive: true });
  return { base, curr };
}

function write(dir: string, name: string, buf: Buffer): void {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const RED: [number, number, number, number] = [255, 0, 0, 255];

describe('listPngs', () => {
  it('finds nested pngs as sorted posix relative paths, ignores non-png', () => {
    const { base } = tmpDirs();
    write(base, 'b/inner.png', makePng(2, 2, WHITE));
    write(base, 'a.png', makePng(2, 2, WHITE));
    write(base, 'notes.txt', Buffer.from('hi'));
    expect(listPngs(base)).toEqual(['a.png', 'b/inner.png']);
  });

  it('returns [] for a missing directory', () => {
    expect(listPngs('/definitely/not/here')).toEqual([]);
  });
});

describe('compareDirectories', () => {
  it('identical images are unchanged', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(50, 50, WHITE));
    write(curr, 'a.png', makePng(50, 50, WHITE));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 });
    expect(s.unchanged).toBe(1);
    expect(s.hasChanges).toBe(false);
    expect(s.results[0].diffRatio).toBe(0);
  });

  it('a differing region marks the image changed with its ratio and both PNGs', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(100, 100, WHITE));
    write(curr, 'a.png', makePngWithRect(100, 100, WHITE, { x: 0, y: 0, w: 10, h: 10, color: RED }));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 });
    expect(s.changed).toBe(1);
    expect(s.hasChanges).toBe(true);
    const r = s.results[0];
    expect(r.diffRatio).toBeCloseTo(0.01, 3);
    expect(r.baselinePng).toBeInstanceOf(Buffer);
    expect(r.currentPng).toBeInstanceOf(Buffer);
  });

  it('a local change on a tall page ships only the band around it, cut from both images', () => {
    const { base, curr } = tmpDirs();
    write(base, 'tall.png', makePng(40, 2000, WHITE));
    write(curr, 'tall.png', makePngWithRect(40, 2000, WHITE, { x: 0, y: 1000, w: 40, h: 10, color: RED }));
    const r = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 }).results[0];
    expect(r.status).toBe('changed');
    expect(r.crop).toMatchObject({ top: 1000 - CROP_MARGIN, height: 10 + 2 * CROP_MARGIN });
    for (const png of [r.crop!.baselinePng, r.crop!.currentPng]) {
      const img = PNG.sync.read(png);
      expect([img.width, img.height]).toEqual([40, 10 + 2 * CROP_MARGIN]);
    }
    // The band's rows really are the changed rows of the current image.
    const cur = PNG.sync.read(r.crop!.currentPng);
    const red = (y: number) => cur.data[(y * 40) * 4 + 1] === 0;
    expect(red(CROP_MARGIN)).toBe(true);
    expect(red(CROP_MARGIN - 1)).toBe(false);
    // Approvals still hash the full screenshots.
    expect(PNG.sync.read(r.currentPng!).height).toBe(2000);
  });

  it('a change spread over the page, or a page that changed size, ships whole', () => {
    const { base, curr } = tmpDirs();
    write(base, 'wide.png', makePng(40, 2000, WHITE));
    write(curr, 'wide.png', makePngWithRect(40, 2000, WHITE, { x: 0, y: 100, w: 40, h: 1500, color: RED }));
    write(base, 'grew.png', makePng(40, 2000, WHITE));
    write(curr, 'grew.png', makePngWithRect(40, 2100, WHITE, { x: 0, y: 1000, w: 40, h: 10, color: RED }));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 });
    for (const r of s.results) {
      expect(r.status).toBe('changed');
      expect(r.crop).toBeUndefined();
    }
  });

  it('unchanged results carry no images', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(20, 20, WHITE));
    write(curr, 'a.png', makePng(20, 20, WHITE));
    const r = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 }).results[0];
    expect(r.baselinePng ?? r.currentPng ?? r.crop).toBeUndefined();
  });

  it('diffRatio tolerance masks small changes', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(100, 100, WHITE));
    write(curr, 'a.png', makePngWithRect(100, 100, WHITE, { x: 0, y: 0, w: 10, h: 10, color: RED }));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0.05 });
    expect(s.changed).toBe(0);
    expect(s.unchanged).toBe(1);
  });

  it('dimension mismatch is always changed, even with a high diffRatio', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(50, 50, WHITE));
    write(curr, 'a.png', makePng(60, 40, WHITE));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0.99 });
    expect(s.changed).toBe(1);
    expect(s.results[0].crop).toBeUndefined();
  });

  it('buckets added and removed screenshots', () => {
    const { base, curr } = tmpDirs();
    write(base, 'gone.png', makePng(10, 10, WHITE));
    write(base, 'same.png', makePng(10, 10, WHITE));
    write(curr, 'same.png', makePng(10, 10, WHITE));
    write(curr, 'new.png', makePng(10, 10, RED));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 });
    expect(s.added).toBe(1);
    expect(s.removed).toBe(1);
    expect(s.unchanged).toBe(1);
    expect(s.hasChanges).toBe(true); // removed counts
    const byName = Object.fromEntries(s.results.map((r) => [r.name, r.status]));
    expect(byName['new.png']).toBe('added');
    expect(byName['gone.png']).toBe('removed');
  });

  it('missing baseline dir means everything is added', () => {
    const { curr } = tmpDirs();
    write(curr, 'a.png', makePng(10, 10, WHITE));
    const s = compareDirectories('/nope', curr, { threshold: 0.1, diffRatio: 0 });
    expect(s.added).toBe(1);
    expect(s.hasChanges).toBe(false);
  });
});

describe('cropBand', () => {
  it('pads the changed rows by the margin, clamped to the page', () => {
    expect(cropBand(1000, 1009, 5000)).toEqual({ top: 1000 - CROP_MARGIN, height: 10 + 2 * CROP_MARGIN });
    expect(cropBand(0, 9, 5000)).toEqual({ top: 0, height: 10 + CROP_MARGIN });
    expect(cropBand(4990, 4999, 5000)).toEqual({ top: 4990 - CROP_MARGIN, height: 10 + CROP_MARGIN });
  });

  it('keeps the whole page when the band would cover most of it or save little', () => {
    expect(cropBand(100, 3500, 5000)).toBeNull(); // more than 60% of the page
    expect(cropBand(100, 110, 600)).toBeNull(); // saves under 400 rows
  });
});
