import { ChevronsLeftRight } from 'lucide-react';
import { Slider, cn } from '../ui';
import * as React from 'react';

export type ViewMode = 'swipe' | 'overlay' | 'blink' | 'sbs';

export const VIEW_LABEL: Record<ViewMode, string> = {
  swipe: 'Swipe',
  overlay: 'Overlay',
  blink: 'Blink',
  sbs: 'Side-by-side',
};

export const VIEW_KEY: Record<ViewMode, string> = { swipe: 'S', overlay: 'O', blink: 'B', sbs: 'D' };

export const VIEW_MODES: ViewMode[] = ['swipe', 'overlay', 'blink', 'sbs'];

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(reducedMotionQuery).matches
  );
  React.useEffect(() => {
    const mq = window.matchMedia?.(reducedMotionQuery);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** A screenshot frame: checkerboard behind transparent pixels, never draggable or selectable. */
export function Frame({
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('checker relative overflow-hidden rounded-md border leading-[0] select-none', className)}
      style={style}
      {...props}
    >
      {children}
    </div>
  );
}

const imgCls = 'block w-full';

export interface Size {
  width: number;
  height: number;
}

/**
 * Stands in for an image that hasn't arrived (or a diff still computing), at
 * the image's own aspect ratio, so the page doesn't jump when it lands.
 */
export function Pending({ size, label, naturalWidth, error }: { size?: Size; label: string; naturalWidth?: number; error?: boolean }) {
  return (
    <Frame
      className="flex items-center justify-center bg-muted/40"
      style={{
        ...(naturalWidth ? { width: naturalWidth } : {}),
        aspectRatio: size ? `${size.width} / ${size.height}` : '16 / 9',
        maxHeight: naturalWidth ? undefined : '70vh',
      }}
      data-pending={error ? 'error' : 'loading'}
    >
      <span className={cn('px-3 text-center font-sans text-xs leading-normal', error ? 'text-destructive' : 'animate-pulse text-muted-foreground')}>
        {label}
      </span>
    </Frame>
  );
}

/** Says when a report shows only the band of a page around its change. */
export function CropNote({ crop, className }: { crop?: { top: number; height: number; fullHeight: number }; className?: string }) {
  if (!crop) return null;
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      Showing rows {crop.top.toLocaleString()}–{(crop.top + crop.height).toLocaleString()} of {crop.fullHeight.toLocaleString()}: the
      change is local, so the report carries only this part of the page.
    </p>
  );
}

/** Width for a frame: natural pixels in the reviewer (so 100% zoom is honest), fluid in cards. */
function frameStyle(naturalWidth?: number): React.CSSProperties | undefined {
  return naturalWidth ? { width: naturalWidth } : undefined;
}

interface SwipeProps {
  baseline?: string;
  current?: string;
  split: number;
  onSplit: (v: number) => void;
  naturalWidth?: number;
  size?: Size;
}

/** Baseline LEFT of the divider, current RIGHT. Drag anywhere on the image to move it. */
export function SwipeView({ baseline, current, split, onSplit, naturalWidth, size }: SwipeProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  if (!baseline || !current) return <Pending size={size} naturalWidth={naturalWidth} label="Loading screenshots…" />;
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    e.stopPropagation(); // the reviewer pans on pointerdown; swiping must not pan
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      onSplit(Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)));
    };
    move(e.nativeEvent);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <Frame
      ref={ref}
      className="cursor-ew-resize touch-none"
      style={frameStyle(naturalWidth)}
      onPointerDown={onPointerDown}
      data-view="swipe"
    >
      <img className={imgCls} src={current} alt="current" draggable={false} />
      <img
        className="absolute top-0 left-0 block w-full"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
        src={baseline}
        alt="baseline"
        draggable={false}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-primary shadow-[0_0_0_1px_rgb(255_255_255/0.7)]"
        style={{ left: `${split}%` }}
      >
        <span className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-white/80">
          <ChevronsLeftRight aria-hidden="true" className="size-4" />
        </span>
      </div>
    </Frame>
  );
}

export function SwipeScrub({ split, onSplit, className }: { split: number; onSplit: (v: number) => void; className?: string }) {
  return (
    <Slider
      className={className}
      min={0}
      max={100}
      step={0.5}
      value={[split]}
      onValueChange={(v) => onSplit(v[0] ?? 50)}
      aria-label="Swipe position"
    />
  );
}

interface OverlayProps {
  current?: string;
  mask?: string;
  opacity: number;
  naturalWidth?: number;
  size?: Size;
  diffError?: string;
}

/** Current screenshot with the changed pixels painted over it. Press and hold to peek underneath. */
export function OverlayView({ current, mask, opacity, naturalWidth, size, diffError }: OverlayProps) {
  const [peek, setPeek] = React.useState(false);
  if (diffError) return <Pending size={size} naturalWidth={naturalWidth} error label={`Couldn't compute the overlay: ${diffError}`} />;
  if (!current || !mask) return <Pending size={size} naturalWidth={naturalWidth} label={current ? 'Finding the changed pixels…' : 'Loading screenshot…'} />;
  return (
    <Frame
      style={frameStyle(naturalWidth)}
      onPointerDown={() => setPeek(true)}
      onPointerUp={() => setPeek(false)}
      onPointerLeave={() => setPeek(false)}
      onPointerCancel={() => setPeek(false)}
      data-view="overlay"
    >
      <img className={imgCls} src={current} alt="current" draggable={false} />
      <img
        className="absolute top-0 left-0 block w-full"
        style={{ opacity: peek ? 0 : opacity / 100 }}
        src={mask}
        alt="changed pixels highlighted"
        draggable={false}
      />
    </Frame>
  );
}

/** Alternates baseline ↔ current every 900ms (unless reduced motion); click flips by hand. */
export function BlinkView({ baseline, current, naturalWidth, size }: { baseline?: string; current?: string; naturalWidth?: number; size?: Size }) {
  const reduced = usePrefersReducedMotion();
  const [showBase, setShowBase] = React.useState(false);
  React.useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setShowBase((s) => !s), 900);
    return () => clearInterval(t);
  }, [reduced]);
  if (!baseline || !current) return <Pending size={size} naturalWidth={naturalWidth} label="Loading screenshots…" />;
  return (
    <Frame
      className="cursor-pointer"
      style={frameStyle(naturalWidth)}
      onClick={() => setShowBase((s) => !s)}
      data-view="blink"
      data-showing={showBase ? 'baseline' : 'current'}
    >
      <img className={imgCls} src={baseline} alt="baseline" draggable={false} />
      <img
        className={cn('absolute top-0 left-0 block w-full', showBase && 'invisible')}
        src={current}
        alt="current"
        draggable={false}
      />
      <span className="absolute top-2 left-2 rounded-sm bg-black/70 px-1.5 py-1 font-mono text-[11px] leading-none text-white">
        {showBase ? 'baseline' : 'current'}
      </span>
    </Frame>
  );
}

interface FigureProps {
  caption: string;
  src?: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  size?: Size;
  pendingLabel?: string;
  error?: string;
}

export function Figure({ caption, src, alt, className, imgClassName, size, pendingLabel = 'Loading screenshot…', error }: FigureProps) {
  return (
    <figure className={cn('m-0 min-w-0', className)}>
      <figcaption className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{caption}</figcaption>
      {error ? (
        <Pending size={size} error label={error} />
      ) : src ? (
        <Frame>
          <img className={cn(imgCls, imgClassName)} src={src} alt={alt} draggable={false} />
        </Frame>
      ) : (
        <Pending size={size} label={pendingLabel} />
      )}
    </figure>
  );
}

interface SideBySideProps {
  baseline?: string;
  current?: string;
  diff?: string;
  large?: boolean;
  size?: Size;
  diffError?: string;
}

export function SideBySideView({ baseline, current, diff, large, size, diffError }: SideBySideProps) {
  const fig = large ? 'w-[30vw] flex-none' : 'flex-1 basis-56';
  return (
    <div className={cn('flex gap-3', large ? 'flex-nowrap' : 'flex-wrap')} data-view="sbs">
      <Figure className={fig} caption="Baseline" src={baseline} alt="baseline" size={size} />
      <Figure className={fig} caption="Current" src={current} alt="current" size={size} />
      <Figure
        className={fig}
        caption="Diff"
        src={diff}
        alt="diff"
        size={size}
        pendingLabel="Computing the diff…"
        error={diffError ? `Couldn't compute the diff: ${diffError}` : undefined}
      />
    </div>
  );
}
