import { Button, Kbd, Tabs, TabsList, TabsTrigger, cn } from '../ui';
import { ChevronLeft, ChevronRight, SkipForward, X } from 'lucide-react';
import * as React from 'react';
import type { ReportItem } from '../../../src/report-data';
import { isVotable, pct } from '../review';
import { StatusBadge, VoteButtons } from './ScreenshotCard';
import { BlinkView, Frame, OverlayView, Pending, SideBySideView, SwipeScrub, SwipeView, VIEW_KEY, VIEW_LABEL, VIEW_MODES, type ViewMode } from './views';
import { useItemImages } from '../use-images';
import { imageUrl } from '../images';

export type ZoomState = 'fit' | 'actual' | 'free';

export interface ReviewerHandle {
  setZoom: (z: 'fit' | 'actual') => void;
}

interface Props {
  items: ReportItem[];
  index: number;
  mode: ViewMode;
  verdictOf: (item: ReportItem) => boolean | null;
  onIndex: (i: number) => void;
  onMode: (m: ViewMode) => void;
  onVote: (v: boolean) => void;
  onNextUnreviewed: () => void;
  onClose: () => void;
  /** Space the fixed command bar takes at the bottom of the viewport. */
  bottomInset: number;
  handleRef: React.Ref<ReviewerHandle>;
}

export function Reviewer(props: Props) {
  const { items, index, mode, verdictOf, onIndex, onMode, onVote, onNextUnreviewed, onClose, bottomInset, handleRef } = props;
  const item = items[index];
  const changed = item.status === 'changed';
  // Sizes come with the metadata, so the stage is laid out before the pixels arrive.
  const ref = changed ? item.current : item.status === 'added' ? item.current : item.baseline;
  const nat = { w: ref?.width ?? 0, h: ref?.height ?? 0 };
  const imgs = useItemImages(item, { enabled: true, withDiff: changed && (mode === 'overlay' || mode === 'sbs') });

  // Warm the neighbours so stepping with ←/→ doesn't wait on decoding.
  React.useEffect(() => {
    for (const n of [items[index + 1], items[index - 1]]) {
      for (const r of [n?.baseline, n?.current]) if (r) imageUrl(r).catch(() => {});
    }
  }, [items, index]);

  const wrap = React.useRef<HTMLDivElement>(null);
  const [zoom, setZoomState] = React.useState<ZoomState>('fit');
  const [view, setView] = React.useState({ scale: 1, tx: 0, ty: 0 });
  const [split, setSplit] = React.useState(50);
  const [panning, setPanning] = React.useState(false);
  const single = !(changed && mode === 'sbs');

  const fitScale = React.useCallback(() => {
    const el = wrap.current;
    if (!el || !nat.w || !nat.h) return 1;
    return Math.min(1, (el.clientWidth - 48) / nat.w, (el.clientHeight - 48) / nat.h);
  }, [nat.w, nat.h]);

  const setZoom = React.useCallback(
    (z: 'fit' | 'actual') => {
      setZoomState(z);
      setView({ scale: z === 'actual' ? 1 : fitScale(), tx: 0, ty: 0 });
    },
    [fitScale]
  );
  React.useImperativeHandle(handleRef, () => ({ setZoom }), [setZoom]);

  // Every new screenshot (or its size arriving) starts fitted.
  React.useLayoutEffect(() => {
    if (!single) {
      setView({ scale: 1, tx: 0, ty: 0 });
      return;
    }
    setZoomState('fit');
    setView({ scale: fitScale(), tx: 0, ty: 0 });
  }, [index, nat.w, nat.h, single, fitScale]);

  // Refit when the viewport (or the command bar under it) changes size.
  React.useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setZoomState((z) => {
        if (z === 'fit' && single) setView({ scale: fitScale(), tx: 0, ty: 0 });
        return z;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitScale, single]);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoomState('free');
      setView((v) => ({ ...v, scale: Math.max(0.1, Math.min(8, v.scale * Math.exp(-e.deltaY * 0.0015))) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = wrap.current;
    if (!el || e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    setPanning(true);
    const sx = e.clientX - view.tx;
    const sy = e.clientY - view.ty;
    const move = (ev: PointerEvent) => setView((v) => ({ ...v, tx: ev.clientX - sx, ty: ev.clientY - sy }));
    const up = () => {
      setPanning(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const votables = items.map((it, i) => ({ it, i })).filter(({ it }) => isVotable(it));
  let yes = 0;
  let no = 0;
  for (const { it } of votables) {
    const v = verdictOf(it);
    if (v === true) yes++;
    else if (v === false) no++;
  }
  const naturalWidth = nat.w || undefined;
  const stat = changed ? `${pct(item.diffRatio)} changed` : item.status === 'added' ? 'new screenshot' : 'removed screenshot';

  let stage: React.ReactNode;
  const size = ref ? { width: ref.width, height: ref.height } : undefined;
  if (!changed) {
    const src = item.status === 'added' ? imgs.current : imgs.baseline;
    stage = src ? (
      <Frame style={naturalWidth ? { width: naturalWidth } : undefined}>
        <img className="block w-full" src={src} alt={item.status === 'added' ? 'current (new)' : 'baseline (removed)'} draggable={false} />
      </Frame>
    ) : (
      <Pending size={size} naturalWidth={naturalWidth} error={!!imgs.error} label={imgs.error ?? 'Loading screenshot…'} />
    );
  } else if (mode === 'overlay') {
    stage = <OverlayView current={imgs.current} mask={imgs.mask} opacity={100} naturalWidth={naturalWidth} size={size} diffError={imgs.diffError} />;
  } else if (mode === 'blink') {
    stage = <BlinkView baseline={imgs.baseline} current={imgs.current} naturalWidth={naturalWidth} size={size} />;
  } else if (mode === 'sbs') {
    stage = <SideBySideView baseline={imgs.baseline} current={imgs.current} diff={imgs.diff} large size={size} diffError={imgs.diffError} />;
  } else {
    stage = <SwipeView baseline={imgs.baseline} current={imgs.current} split={split} onSplit={setSplit} naturalWidth={naturalWidth} size={size} />;
  }

  return (
    <div
      className="dark fixed inset-x-0 top-0 z-40 flex flex-col bg-background text-foreground"
      style={{ bottom: bottomInset }}
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot reviewer"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-5">
        <span className="font-mono text-sm text-muted-foreground tabular-nums">
          {index + 1} / {items.length}
        </span>
        <StatusBadge status={item.status} />
        <span className="min-w-0 font-mono text-sm font-medium break-all">{item.name}</span>
        <span className={cn('font-mono text-sm', changed ? 'text-warning' : 'text-muted-foreground')}>{stat}</span>
        {item.crop ? (
          <span className="font-mono text-xs text-muted-foreground" title="The change is local, so the report carries only this part of the page.">
            rows {item.crop.top.toLocaleString()}–{(item.crop.top + item.crop.height).toLocaleString()} of {item.crop.fullHeight.toLocaleString()}
          </span>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <VoteButtons item={item} verdict={verdictOf(item)} onVote={onVote} labels />
          {isVotable(item) ? (
            <Button type="button" variant="ghost" size="sm" onClick={onNextUnreviewed}>
              <SkipForward aria-hidden="true" /> Next unreviewed <Kbd>U</Kbd>
            </Button>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {changed ? (
            <Tabs value={mode} onValueChange={(v) => onMode(v as ViewMode)}>
              <TabsList aria-label="Comparison view" className="h-9">
                {VIEW_MODES.map((m) => (
                  <TabsTrigger key={m} value={m} className="gap-1.5 py-1">
                    {VIEW_LABEL[m]} <Kbd className="hidden md:inline-flex">{VIEW_KEY[m]}</Kbd>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            <X aria-hidden="true" /> Close <Kbd>Esc</Kbd>
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <NavButton side="prev" onClick={() => onIndex(index - 1)} />
        <div
          ref={wrap}
          className={cn('relative flex-1 overflow-hidden', panning ? 'cursor-grabbing' : 'cursor-grab')}
          onPointerDown={onPointerDown}
          onDoubleClick={() => setZoom('fit')}
          data-testid="reviewer-stage"
        >
          <div
            className="absolute top-1/2 left-1/2 origin-center leading-[0]"
            style={{ transform: `translate(-50%,-50%) translate(${view.tx}px,${view.ty}px) scale(${view.scale})` }}
          >
            {stage}
          </div>
        </div>
        <NavButton side="next" onClick={() => onIndex(index + 1)} />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
        {changed && mode === 'swipe' ? <SwipeScrub split={split} onSplit={setSplit} className="w-56" /> : null}
        {single ? (
          <span className="flex items-center gap-1.5">
            <Button type="button" variant={zoom === 'fit' ? 'secondary' : 'ghost'} size="sm" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>
              Fit <Kbd>F</Kbd>
            </Button>
            <Button type="button" variant={zoom === 'actual' ? 'secondary' : 'ghost'} size="sm" aria-pressed={zoom === 'actual'} onClick={() => setZoom('actual')}>
              100% <Kbd>1</Kbd>
            </Button>
            <span className="min-w-11 font-mono tabular-nums">{Math.round(view.scale * 100)}%</span>
          </span>
        ) : null}
        {votables.length > 0 ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] tracking-wider uppercase">Progress</span>
            <span className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Review progress">
              {votables.map(({ it, i }) => {
                const v = verdictOf(it);
                return (
                  <button
                    key={it.name}
                    type="button"
                    aria-label={`${it.name}${v === true ? ' (approved)' : v === false ? ' (rejected)' : ''}`}
                    aria-current={i === index ? 'true' : undefined}
                    onClick={() => onIndex(i)}
                    className={cn(
                      'size-2.5 rounded-full border border-muted-foreground/60 focus-ring',
                      v === true && 'border-success bg-success',
                      v === false && 'border-destructive bg-destructive',
                      i === index && 'outline-2 outline-offset-1 outline-foreground'
                    )}
                  />
                );
              })}
            </span>
            <span className="tabular-nums">
              {yes} approved · {no} rejected · {votables.length - yes - no} left
            </span>
          </span>
        ) : null}
        <span className="ml-auto hidden items-center gap-1 lg:flex">
          scroll to zoom · drag to pan · double-click resets · <Kbd>←</Kbd>
          <Kbd>→</Kbd> or <Kbd>J</Kbd>
          <Kbd>K</Kbd> navigate
        </span>
      </div>
    </div>
  );
}

function NavButton({ side, onClick }: { side: 'prev' | 'next'; onClick: () => void }) {
  const Icon = side === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      aria-label={side === 'prev' ? 'Previous screenshot' : 'Next screenshot'}
      className={cn(
        'absolute top-1/2 z-10 h-auto -translate-y-1/2 flex-col gap-1 rounded-xl bg-card/90 px-3 py-3 backdrop-blur',
        side === 'prev' ? 'left-3' : 'right-3'
      )}
    >
      <Icon aria-hidden="true" className="size-6" />
      <Kbd>{side === 'prev' ? '←' : '→'}</Kbd>
    </Button>
  );
}
