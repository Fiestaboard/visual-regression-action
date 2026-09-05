import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { compareDirectories, listPngs } from '../src/diff';
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

  it('a differing region marks the image changed with a diff PNG and ratio', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(100, 100, WHITE));
    write(curr, 'a.png', makePngWithRect(100, 100, WHITE, { x: 0, y: 0, w: 10, h: 10, color: RED }));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 });
    expect(s.changed).toBe(1);
    expect(s.hasChanges).toBe(true);
    const r = s.results[0];
    expect(r.diffRatio).toBeCloseTo(0.01, 3);
    expect(r.diffPng).toBeInstanceOf(Buffer);
    expect(r.baselinePng).toBeInstanceOf(Buffer);
    expect(r.currentPng).toBeInstanceOf(Buffer);
  });

  it('changed results carry a transparent diff mask marking only changed pixels', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(100, 100, WHITE));
    write(curr, 'a.png', makePngWithRect(100, 100, WHITE, { x: 10, y: 10, w: 10, h: 10, color: RED }));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 });
    const r = s.results[0];
    expect(r.diffMaskPng).toBeInstanceOf(Buffer);
    const mask = PNG.sync.read(r.diffMaskPng!);
    const alphaAt = (x: number, y: number) => mask.data[(y * 100 + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0); // unchanged pixel: fully transparent
    expect(alphaAt(15, 15)).toBeGreaterThan(0); // changed pixel: visible
  });

  it('unchanged results carry no diff mask', () => {
    const { base, curr } = tmpDirs();
    write(base, 'a.png', makePng(20, 20, WHITE));
    write(curr, 'a.png', makePng(20, 20, WHITE));
    const s = compareDirectories(base, curr, { threshold: 0.1, diffRatio: 0 });
    expect(s.results[0].diffMaskPng).toBeUndefined();
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
    expect(s.results[0].diffPng).toBeInstanceOf(Buffer);
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
