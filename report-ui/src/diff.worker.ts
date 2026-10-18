// Computes a screenshot's diff and overlay off the main thread: a full-page
// capture can be tens of millions of pixels, and pixelmatch would otherwise
// freeze the reviewer while it runs.
import { renderDiff, type DiffRequest } from './diff-render';

self.onmessage = async (e: MessageEvent<DiffRequest & { id: number }>) => {
  const { id, ...req } = e.data;
  try {
    self.postMessage({ id, ...(await renderDiff(req)) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
