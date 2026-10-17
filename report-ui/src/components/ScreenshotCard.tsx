import {
  Badge,
  Button,
  Card,
  Slider,
  StatusDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  cn,
} from '../ui';
import { Check, Maximize2, X } from 'lucide-react';
import * as React from 'react';
import type { ReportItem, ReportStatus } from '../../../src/report-data';
import { isLocked, isVotable, pct, STATUS_LABEL } from '../review';
import { BlinkView, Figure, OverlayView, SideBySideView, SwipeScrub, SwipeView, VIEW_LABEL, VIEW_MODES, type ViewMode } from './views';

export const STATUS_DOT: Record<ReportStatus, 'warning' | 'info' | 'danger' | 'success'> = {
  changed: 'warning',
  added: 'info',
  removed: 'danger',
  unchanged: 'success',
};

export function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <StatusDot status={STATUS_DOT[status]} size="sm" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Heat bar: sqrt-scaled so a 1% change is visible but a 100% change still fills it. */
export function Heat({ ratio, className }: { ratio: number; className?: string }) {
  const width = Math.min(100, Math.round(Math.sqrt(ratio) * 100));
  return (
    <div aria-hidden="true" className={cn('h-1 overflow-hidden rounded-full bg-muted', className)}>
      <div className="h-full rounded-full bg-warning" style={{ width: `${width}%` }} />
    </div>
  );
}

interface VoteProps {
  item: ReportItem;
  verdict: boolean | null;
  onVote: (v: boolean) => void;
  size?: 'sm' | 'default';
  labels?: boolean;
}

export function VoteButtons({ item, verdict, onVote, size = 'sm', labels }: VoteProps) {
  if (!isVotable(item)) return null;
  if (isLocked(item)) {
    return (
      <Badge variant="success" className="font-sans">
        <Check aria-hidden="true" /> Approved on PR
      </Badge>
    );
  }
  return (
    <div className="flex gap-1.5" role="group" aria-label={`Verdict for ${item.name}`}>
      <Button
        type="button"
        variant="outline"
        size={labels ? size : size === 'sm' ? 'icon-sm' : 'icon'}
        aria-pressed={verdict === true}
        title="Approve (A in the reviewer)"
        aria-label={labels ? undefined : 'Approve'}
        onClick={() => onVote(true)}
        className={cn(
          // dark: twins needed — the outline variant sets its own dark:bg/border, which outrank plain utilities.
          verdict === true &&
            'border-success bg-success text-success-foreground hover:bg-success/90 hover:text-success-foreground dark:border-success dark:bg-success dark:hover:bg-success/90'
        )}
      >
        <Check aria-hidden="true" />
        {labels ? 'Approve' : null}
      </Button>
      <Button
        type="button"
        variant="outline"
        size={labels ? size : size === 'sm' ? 'icon-sm' : 'icon'}
        aria-pressed={verdict === false}
        title="Reject (R in the reviewer)"
        aria-label={labels ? undefined : 'Reject'}
        onClick={() => onVote(false)}
        className={cn(
          verdict === false &&
            'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground dark:border-destructive dark:bg-destructive dark:hover:bg-destructive/90'
        )}
      >
        <X aria-hidden="true" />
        {labels ? 'Reject' : null}
      </Button>
    </div>
  );
}

interface CardProps {
  item: ReportItem;
  id: string;
  verdict: boolean | null;
  onVote: (v: boolean) => void;
  onExpand: () => void;
}

export function ScreenshotCard({ item, id, verdict, onVote, onExpand }: CardProps) {
  if (item.status === 'unchanged') {
    return (
      <Card id={id} data-status="unchanged" className="flex scroll-mt-36 items-center gap-3 px-5 py-3">
        <StatusBadge status="unchanged" />
        <h3 className="min-w-0 truncate font-mono text-sm">{item.name}</h3>
      </Card>
    );
  }
  return (
    <Card id={id} data-status={item.status} className="scroll-mt-36 gap-0 p-5">
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusBadge status={item.status} />
        <h3 className="mr-auto min-w-0 font-mono text-[15px] font-medium break-all">{item.name}</h3>
        {item.status === 'changed' ? (
          <span className="font-mono text-sm text-muted-foreground tabular-nums">{pct(item.diffRatio)}</span>
        ) : null}
        <VoteButtons item={item} verdict={verdict} onVote={onVote} />
        <Button type="button" variant="ghost" size="sm" onClick={onExpand}>
          <Maximize2 aria-hidden="true" /> Expand
        </Button>
      </header>
      {item.status === 'changed' ? (
        <ChangedStage item={item} />
      ) : (
        <Figure
          caption={item.status === 'added' ? 'Current (new)' : 'Baseline (removed)'}
          src={item.status === 'added' ? item.current : item.baseline}
          alt={item.status === 'added' ? 'current (new)' : 'baseline (removed)'}
        />
      )}
    </Card>
  );
}

function ChangedStage({ item }: { item: ReportItem }) {
  const [mode, setMode] = React.useState<ViewMode>('swipe');
  const [split, setSplit] = React.useState(50);
  const [maskOpacity, setMaskOpacity] = React.useState(100);
  return (
    <>
      <Heat ratio={item.diffRatio} className="mb-4" />
      <Tabs value={mode} onValueChange={(v) => setMode(v as ViewMode)}>
        <TabsList aria-label="Comparison view" className="h-9 flex-wrap justify-start">
          {VIEW_MODES.map((m) => (
            <TabsTrigger key={m} value={m} className="py-1">
              {VIEW_LABEL[m]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="swipe" className="mt-3">
          <SwipeView baseline={item.baseline} current={item.current} split={split} onSplit={setSplit} />
          <SwipeScrub split={split} onSplit={setSplit} className="mt-4" />
          <Text size="xs" tone="muted" className="mt-2">
            Left of the line: baseline · right: current
          </Text>
        </TabsContent>
        <TabsContent value="overlay" className="mt-3">
          <OverlayView current={item.current} mask={item.mask} opacity={maskOpacity} />
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-3 text-xs text-muted-foreground">
              Mask
              <Slider
                className="w-36"
                min={0}
                max={100}
                value={[maskOpacity]}
                onValueChange={(v) => setMaskOpacity(v[0] ?? 100)}
                aria-label="Mask opacity"
              />
            </label>
            <Text as="span" size="xs" tone="muted">
              Press and hold the image to peek underneath
            </Text>
          </div>
        </TabsContent>
        <TabsContent value="blink" className="mt-3">
          <BlinkView baseline={item.baseline} current={item.current} />
          <Text size="xs" tone="muted" className="mt-2">
            Alternating baseline ↔ current. Motion off? Click the image to flip.
          </Text>
        </TabsContent>
        <TabsContent value="sbs" className="mt-3">
          <SideBySideView baseline={item.baseline} current={item.current} diff={item.diff} />
        </TabsContent>
      </Tabs>
    </>
  );
}
