// Image store: turns the report's streamed <i data-png> elements into Blob
// URLs, on demand.
//
// The action embeds each image as its own element after the app's script, so
// this module can run while they are still downloading. An image is only
// decoded when a view asks for it — a card scrolling into view, the reviewer
// opening — and then once: the element is dropped and its Blob URL cached, so
// the base64 text is not held twice.
import type { ImageRef } from '../../src/report-data';

const cache = new Map<string, Promise<string>>();

/** Resolves with the element once the parser has inserted it; rejects if the document finishes without it. */
function whenParsed(id: string): Promise<Element> {
  const found = document.getElementById(id);
  if (found) return Promise.resolve(found);
  if (document.readyState !== 'loading') return Promise.reject(new Error(`image ${id} is missing from the report`));
  return new Promise((resolve, reject) => {
    const done = () => {
      observer.disconnect();
      document.removeEventListener('DOMContentLoaded', onLoaded);
    };
    const observer = new MutationObserver(() => {
      const el = document.getElementById(id);
      if (el) {
        done();
        resolve(el);
      }
    });
    const onLoaded = () => {
      done();
      const el = document.getElementById(id);
      if (el) resolve(el);
      else reject(new Error(`image ${id} is missing from the report`));
    };
    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', onLoaded);
  });
}

async function base64ToBlob(b64: string): Promise<Blob> {
  try {
    return await (await fetch(`data:image/png;base64,${b64}`)).blob();
  } catch {
    // Some sandboxes refuse fetch() of data: URLs; decode by hand instead.
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  }
}

/** A Blob URL for an embedded image, waiting for it to arrive if it hasn't yet. */
export function imageUrl(ref: ImageRef): Promise<string> {
  let p = cache.get(ref.id);
  if (!p) {
    p = whenParsed(ref.id).then(async (el) => {
      const b64 = el.getAttribute('data-png') ?? '';
      el.remove();
      return URL.createObjectURL(await base64ToBlob(b64));
    });
    cache.set(ref.id, p);
  }
  return p;
}

/** The decoded bytes behind an image's Blob URL. */
export async function imageBlob(ref: ImageRef): Promise<Blob> {
  return (await fetch(await imageUrl(ref))).blob();
}
