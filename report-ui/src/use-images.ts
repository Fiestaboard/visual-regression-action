import * as React from 'react';
import type { ReportItem } from '../../src/report-data';
import { imageUrl } from './images';
import { diffUrls } from './diff-client';

export interface ItemImages {
  baseline?: string;
  current?: string;
  diff?: string;
  mask?: string;
  /** The diff was asked for and could not be computed. */
  diffError?: string;
  /** An image could not be read from the report. */
  error?: string;
}

/** The compare's pixelmatch threshold, which the in-browser diff must reuse. */
export const ThresholdContext = React.createContext(0.1);

/**
 * Blob URLs for a screenshot's images, loaded only while `enabled` (the card
 * is near the viewport, or the reviewer shows it). The diff and overlay are
 * computed only when `withDiff` — the views that draw them are not the default.
 */
export function useItemImages(item: ReportItem, { enabled, withDiff }: { enabled: boolean; withDiff: boolean }): ItemImages {
  const threshold = React.useContext(ThresholdContext);
  const [state, setState] = React.useState<ItemImages>({});
  // A new item starts empty, so a previous screenshot never shows under another's name.
  React.useEffect(() => setState({}), [item.name]);

  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    const set = (patch: ItemImages) => live && setState((s) => ({ ...s, ...patch }));
    if (item.baseline) imageUrl(item.baseline).then((baseline) => set({ baseline }), (e) => set({ error: String(e.message ?? e) }));
    if (item.current) imageUrl(item.current).then((current) => set({ current }), (e) => set({ error: String(e.message ?? e) }));
    return () => {
      live = false;
    };
  }, [enabled, item]);

  React.useEffect(() => {
    if (!enabled || !withDiff || item.status !== 'changed') return;
    let live = true;
    diffUrls(item, threshold).then(
      ({ diff, mask }) => live && setState((s) => ({ ...s, diff, mask })),
      (e) => live && setState((s) => ({ ...s, diffError: String(e?.message ?? e) }))
    );
    return () => {
      live = false;
    };
  }, [enabled, withDiff, item, threshold]);

  return state;
}

/** True once the element has come within `margin` of the viewport — and stays true. */
export function useNearViewport<T extends Element>(margin = '800px'): [React.RefCallback<T>, boolean] {
  const [seen, setSeen] = React.useState(false);
  const observer = React.useRef<IntersectionObserver | null>(null);
  const ref = React.useCallback(
    (el: T | null) => {
      observer.current?.disconnect();
      if (!el || seen) return;
      if (typeof IntersectionObserver === 'undefined') return setSeen(true);
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setSeen(true);
            observer.current?.disconnect();
          }
        },
        { rootMargin: margin }
      );
      observer.current.observe(el);
    },
    [margin, seen]
  );
  return [ref, seen];
}
