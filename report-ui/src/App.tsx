import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Code,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusDot,
  TextLink,
  ThemeToggle,
  Toggle,
  cn,
} from './ui';
import { Check, Play, TriangleAlert, X } from 'lucide-react';
import * as React from 'react';
import type { ReportData, ReportItem, ReportStatus } from '../../src/report-data';
import { CommandBar } from './components/CommandBar';
import { Reviewer, type ReviewerHandle } from './components/Reviewer';
import { ScreenshotCard, STATUS_DOT } from './components/ScreenshotCard';
import type { ViewMode } from './components/views';
import {
  coverage as computeCoverage,
  isVotable,
  loadDecisions,
  pct,
  saveDecisions,
  sortItems,
  STATUS_LABEL,
  STATUS_ORDER,
  verdict,
  type Decisions,
} from './review';

type Order = 'review' | 'ratio';

function useTheme(): ['light' | 'dark', () => void] {
  const [theme, setTheme] = React.useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );
  const toggle = React.useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try {
        localStorage.setItem('vrt-theme', next);
      } catch {
        /* per-viewer convenience only */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

function useElementHeight(el: HTMLElement | null): number {
  const [h, setH] = React.useState(0);
  React.useEffect(() => {
    if (!el) return setH(0);
    setH(el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return h;
}

export function App({ data }: { data: ReportData }) {
  // Stable ids follow the action's order, whatever the on-screen sort.
  const idOf = React.useMemo(() => new Map(data.items.map((it, i) => [it.name, `shot-${i}`])), [data.items]);
  const counts = React.useMemo(() => {
    const c: Record<ReportStatus, number> = { changed: 0, added: 0, removed: 0, unchanged: 0 };
    for (const it of data.items) c[it.status]++;
    return c;
  }, [data.items]);

  const [decisions, setDecisions] = React.useState<Decisions>(() => loadDecisions(data.runUrl));
  const [shown, setShown] = React.useState<Record<ReportStatus, boolean>>({ changed: true, added: true, removed: true, unchanged: true });
  const [order, setOrder] = React.useState<Order>('review');
  const [reviewIdx, setReviewIdx] = React.useState<number | null>(null);
  const [mode, setMode] = React.useState<ViewMode>('swipe');
  const [active, setActive] = React.useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();
  const [cmdEl, setCmdEl] = React.useState<HTMLDivElement | null>(null);
  const cmdHeight = useElementHeight(cmdEl);
  const reviewer = React.useRef<ReviewerHandle>(null);

  React.useEffect(() => saveDecisions(data.runUrl, decisions), [data.runUrl, decisions]);

  const ordered = React.useMemo(() => sortItems(data.items, order), [data.items, order]);
  const visible = ordered.filter((it) => shown[it.status]);
  const reviewable = React.useMemo(() => ordered.filter((it) => it.status !== 'unchanged'), [ordered]);
  const cov = computeCoverage(data.items, decisions, data.pin);
  const verdictOf = React.useCallback((it: ReportItem) => verdict(it, decisions), [decisions]);

  const vote = React.useCallback((item: ReportItem, v: boolean) => {
    if (!isVotable(item) || item.approved) return;
    setDecisions((d) => {
      const next = { ...d };
      if (next[item.name] === v) delete next[item.name];
      else next[item.name] = v;
      return next;
    });
  }, []);

  const wrapIdx = (i: number) => (i + reviewable.length) % reviewable.length;
  const open = (item?: ReportItem) => {
    if (!reviewable.length) return;
    const i = item ? reviewable.indexOf(item) : 0;
    setReviewIdx(Math.max(0, i));
  };
  const nextUnreviewed = React.useCallback(
    (from: number) => {
      for (let k = 1; k <= reviewable.length; k++) {
        const i = (from + k) % reviewable.length;
        if (isVotable(reviewable[i]) && verdict(reviewable[i], decisions) === null) return setReviewIdx(i);
      }
    },
    [reviewable, decisions]
  );
  const voteInReviewer = (v: boolean) => {
    if (reviewIdx === null) return;
    const item = reviewable[reviewIdx];
    if (!isVotable(item) || item.approved) return;
    const was = verdict(item, decisions);
    vote(item, v);
    // A first verdict moves on to the next screenshot still awaiting one (skipping
    // added screenshots, which need no vote); changing a verdict stays put.
    if (was !== null) return;
    for (let k = 1; k < reviewable.length; k++) {
      const i = wrapIdx(reviewIdx + k);
      if (isVotable(reviewable[i]) && verdict(reviewable[i], decisions) === null) return setReviewIdx(i);
    }
    setReviewIdx(wrapIdx(reviewIdx + 1));
  };

  // Sidebar highlight follows the card nearest the top of the viewport.
  React.useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) if (en.isIntersecting) setActive(en.target.id);
      },
      { rootMargin: '-140px 0px -65% 0px' }
    );
    document.querySelectorAll('main [id^="shot-"]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [visible.length, order]);

  // Keyboard: reviewer shortcuts while it is open, J/K card hopping otherwise.
  const keyState = React.useRef({ reviewIdx, reviewable, visible });
  keyState.current = { reviewIdx, reviewable, visible };
  const handlers = React.useRef({ voteInReviewer, nextUnreviewed });
  handlers.current = { voteInReviewer, nextUnreviewed };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { reviewIdx: idx, reviewable: list, visible: vis } = keyState.current;
      const k = e.key.toLowerCase();
      if (idx === null) {
        if (k === 'j' || k === 'k') {
          const cards = vis
            .filter((it) => it.status !== 'unchanged')
            .map((it) => document.getElementById(idOf.get(it.name)!))
            .filter((el): el is HTMLElement => !!el);
          if (!cards.length) return;
          const y = window.scrollY + 150;
          let cur = 0;
          cards.forEach((c, i) => {
            if (c.getBoundingClientRect().top + window.scrollY <= y + 4) cur = i;
          });
          const next = cards[Math.max(0, Math.min(cards.length - 1, cur + (k === 'j' ? 1 : -1)))];
          const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
          next.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        }
        return;
      }
      const n = list.length;
      const go = (i: number) => setReviewIdx((i + n) % n);
      const map: Record<string, () => void> = {
        escape: () => setReviewIdx(null),
        arrowright: () => go(idx + 1),
        j: () => go(idx + 1),
        arrowleft: () => go(idx - 1),
        k: () => go(idx - 1),
        s: () => setMode('swipe'),
        o: () => setMode('overlay'),
        b: () => setMode('blink'),
        d: () => setMode('sbs'),
        a: () => handlers.current.voteInReviewer(true),
        r: () => handlers.current.voteInReviewer(false),
        u: () => handlers.current.nextUnreviewed(idx),
        f: () => reviewer.current?.setZoom('fit'),
        '1': () => reviewer.current?.setZoom('actual'),
      };
      const fn = map[k];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [idOf]);

  // The reviewer owns the viewport; stop the page behind it scrolling.
  React.useEffect(() => {
    if (reviewIdx === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [reviewIdx !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = (() => {
    if (cov.total === 0) return { text: 'Nothing needs review.', done: true };
    const reviewed = cov.approved + cov.rejected;
    return {
      text: `${reviewed} of ${cov.total} reviewed${reviewed === cov.total ? ' — review complete' : ''}`,
      done: reviewed === cov.total,
    };
  })();

  return (
    <div className="min-h-screen" style={{ paddingBottom: cmdHeight + 32 }}>
      <header className="top-0 z-30 border-b bg-background/90 backdrop-blur sm:sticky">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="m-0 mr-auto text-lg font-semibold tracking-tight">Visual regression report</h1>
            <span
              className={cn('text-sm font-medium tabular-nums', progress.done ? 'text-success' : 'text-muted-foreground')}
              data-testid="progress"
            >
              {progress.done && cov.total > 0 ? <Check aria-hidden="true" className="mr-1 inline size-4 align-[-3px]" /> : null}
              {progress.text}
            </span>
            {reviewable.length > 0 ? (
              <Button type="button" variant="brand" onClick={() => open()}>
                <Play aria-hidden="true" /> Start review
              </Button>
            ) : null}
            <ThemeToggle theme={theme} onToggle={toggleTheme} label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_ORDER.map((s) => (
              <Toggle
                key={s}
                variant="outline"
                size="sm"
                pressed={shown[s]}
                onPressedChange={(p) => setShown((cur) => ({ ...cur, [s]: p }))}
                aria-label={`Show ${STATUS_LABEL[s].toLowerCase()} screenshots`}
                className={cn(
                  'gap-2 rounded-full px-3',
                  // All filters start on, so "on" is the quiet state; "off" dims and strikes through.
                  'data-[pressed]:border-border data-[pressed]:bg-card data-[pressed]:text-foreground data-[pressed]:hover:bg-accent data-[pressed]:active:bg-accent',
                  'not-data-[pressed]:text-muted-foreground not-data-[pressed]:opacity-70'
                )}
              >
                <StatusDot status={STATUS_DOT[s]} size="sm" />
                <span className={cn(!shown[s] && 'line-through')}>{STATUS_LABEL[s]}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{counts[s]}</span>
              </Toggle>
            ))}
            <div className="ml-auto">
              <Select value={order} onValueChange={(v) => setOrder(v as Order)}>
                <SelectTrigger aria-label="Sort order" className="h-8 w-48 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="review">Review order</SelectItem>
                  <SelectItem value="ratio">Largest diff first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{data.repo}</span>
            <span aria-hidden="true">·</span>
            <span>
              commit <Code>{data.pin}</Code>
            </span>
            <span aria-hidden="true">·</span>
            <TextLink href={data.runUrl}>workflow run</TextLink>
            {data.baselineRunUrl ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  baseline from <TextLink href={data.baselineRunUrl}>this run</TextLink>
                </span>
              </>
            ) : null}
            {data.prUrl ? (
              <>
                <span aria-hidden="true">·</span>
                <TextLink href={data.prUrl}>pull request</TextLink>
              </>
            ) : null}
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1360px] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="sticky top-36 hidden max-h-[calc(100vh-9rem)] self-start overflow-y-auto py-5 pr-2 pl-4 lg:block" aria-label="Screenshots">
          <nav className="flex flex-col gap-0.5">
            {visible.map((it) => {
              const id = idOf.get(it.name)!;
              const v = verdict(it, decisions);
              return (
                <a
                  key={it.name}
                  href={`#${id}`}
                  aria-current={active === id ? 'location' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-foreground no-underline focus-ring hover:bg-accent',
                    active === id && 'bg-accent ring-1 ring-border'
                  )}
                >
                  <StatusDot status={STATUS_DOT[it.status]} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-mono">{it.name}</span>
                  <span className="flex-none font-mono text-[11px] text-muted-foreground tabular-nums">
                    {it.status === 'changed' ? pct(it.diffRatio) : it.status}
                  </span>
                  <span className="flex w-3.5 flex-none justify-center" aria-label={v === true ? 'approved' : v === false ? 'rejected' : undefined}>
                    {v === true ? <Check aria-hidden="true" className="size-3.5 text-success" /> : null}
                    {v === false ? <X aria-hidden="true" className="size-3.5 text-destructive" /> : null}
                  </span>
                </a>
              );
            })}
          </nav>
        </aside>

        <main className="flex min-w-0 flex-col gap-5 px-4 py-5 sm:px-6">
          {data.missingBaseline ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>No baseline found</AlertTitle>
              <AlertDescription>
                Every screenshot is recorded as new. The default branch publishes a baseline on its next build.
              </AlertDescription>
            </Alert>
          ) : null}
          {visible.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {data.items.length === 0 ? 'No screenshots in this run.' : 'Every status is filtered out — turn a filter back on above.'}
            </p>
          ) : null}
          {visible.map((it) => (
            <ScreenshotCard
              key={it.name}
              id={idOf.get(it.name)!}
              item={it}
              verdict={verdict(it, decisions)}
              onVote={(v) => vote(it, v)}
              onExpand={() => open(it)}
            />
          ))}
        </main>
      </div>

      {reviewIdx !== null && reviewable[reviewIdx] ? (
        <Reviewer
          handleRef={reviewer}
          items={reviewable}
          index={reviewIdx}
          mode={mode}
          verdictOf={verdictOf}
          onIndex={(i) => setReviewIdx(wrapIdx(i))}
          onMode={setMode}
          onVote={voteInReviewer}
          onNextUnreviewed={() => nextUnreviewed(reviewIdx)}
          onClose={() => setReviewIdx(null)}
          bottomInset={cmdHeight}
        />
      ) : null}

      <CommandBar ref={setCmdEl} coverage={cov} prUrl={data.prUrl} onReset={() => setDecisions({})} dark={reviewIdx !== null} />
    </div>
  );
}
