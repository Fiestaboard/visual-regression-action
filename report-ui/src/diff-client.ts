import type { ReportItem } from '../../src/report-data';
import { imageBlob } from './images';
import { renderDiff, type DiffRequest, type DiffResult } from './diff-render';
import DiffWorker from './diff.worker?worker&inline';

export interface DiffUrls {
  diff: string;
  mask: string;
}

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (r: DiffResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new DiffWorker();
    worker.onmessage = (e: MessageEvent<{ id: number; error?: string } & Partial<DiffResult>>) => {
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (!job) return;
      if (e.data.error || !e.data.diff || !e.data.mask) job.reject(new Error(e.data.error ?? 'diff failed'));
      else job.resolve({ diff: e.data.diff, mask: e.data.mask });
    };
    worker.onerror = () => {
      // A worker that cannot start (some sandboxed viewers) falls back to the main thread.
      for (const job of pending.values()) job.reject(new Error('diff worker failed'));
      pending.clear();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function inWorker(req: DiffRequest): Promise<DiffResult> {
  const w = getWorker();
  if (!w) return renderDiff(req);
  const id = nextId++;
  return new Promise<DiffResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, ...req });
  }).catch(() => renderDiff(req));
}

const cache = new Map<string, Promise<DiffUrls>>();

/** Diff and overlay for a changed screenshot, computed once and cached. */
export function diffUrls(item: ReportItem, threshold: number): Promise<DiffUrls> {
  let p = cache.get(item.name);
  if (!p) {
    if (!item.baseline || !item.current) return Promise.reject(new Error('nothing to diff'));
    const [b, c] = [item.baseline, item.current];
    p = Promise.all([imageBlob(b), imageBlob(c)])
      .then(([baseline, current]) => inWorker({ baseline, current, threshold }))
      .then(({ diff, mask }) => ({ diff: URL.createObjectURL(diff), mask: URL.createObjectURL(mask) }));
    // A failure is not cached, so reopening the view tries again.
    p.catch(() => cache.delete(item.name));
    cache.set(item.name, p);
  }
  return p;
}
