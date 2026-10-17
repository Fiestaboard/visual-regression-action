import { Button, CopyButton, Input, cn } from '../ui';
import { ExternalLink, ListChecks } from 'lucide-react';
import * as React from 'react';
import type { Coverage } from '../review';

interface Props {
  coverage: Coverage;
  prUrl?: string;
  onReset: () => void;
  /** Match the reviewer, which is always dark, while it is open. */
  dark?: boolean;
  ref?: React.Ref<HTMLDivElement>;
}

function message(c: Coverage): React.ReactNode {
  const fresh = c.approved - c.approvedOnPr;
  const onPr = c.approvedOnPr > 0 ? ` (${c.approvedOnPr} already approved on the PR)` : '';
  switch (c.state) {
    case 'idle':
      return c.approvedOnPr === c.total
        ? `All ${c.total} changes are already approved on the PR — nothing left to do.`
        : `Review each change: approve (A) or reject (R). An approval command assembles here as you go${onPr}.`;
    case 'rejected-only':
      return `${c.rejected} rejected · 0 newly approved — nothing to post. Fix the rejected changes and push, or approve the intentional ones.`;
    case 'partial':
      return `Covers ${c.approved} of ${c.total}${onPr} — ${c.unreviewed} still unreviewed. The check stays red until every changed and removed screenshot is approved.`;
    case 'with-rejections':
      return `Covers ${c.approved} of ${c.total} — ${c.rejected} rejected, so the check stays red until those are fixed. Post the ${fresh} approval${fresh === 1 ? '' : 's'} as a PR comment:`;
    case 'complete':
      return `Covers all ${c.total} changes — post this as a PR comment and the check passes:`;
    default:
      return '';
  }
}

const TONE: Record<Coverage['state'], string> = {
  nothing: 'border-t-border',
  idle: 'border-t-brand',
  'rejected-only': 'border-t-warning',
  partial: 'border-t-warning',
  'with-rejections': 'border-t-warning',
  complete: 'border-t-success',
};

export function CommandBar({ coverage: c, prUrl, onReset, dark, ref }: Props) {
  if (c.state === 'nothing') return null;
  const hasCommand = c.command !== '';
  const openPr = async () => {
    try {
      await navigator.clipboard?.writeText(c.command);
    } catch {
      /* clipboard blocked — the command is still selectable in the field */
    }
    window.open(`${prUrl}#issue-comment-box`, '_blank', 'noopener');
  };
  return (
    <div
      ref={ref}
      data-coverage={c.state}
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 border-t-2 bg-card/95 px-4 py-3 text-card-foreground shadow-[0_-4px_16px_rgb(0_0_0/0.12)] backdrop-blur sm:px-6',
        TONE[c.state],
        dark && 'dark'
      )}
    >
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-3 gap-y-2">
        <p
          className={cn(
            'm-0 basis-full text-sm',
            c.state === 'complete' && 'font-semibold text-success',
            (c.state === 'partial' || c.state === 'rejected-only' || c.state === 'with-rejections') && 'font-semibold text-warning'
          )}
          data-testid="coverage"
        >
          {message(c)}
        </p>
        {hasCommand ? (
          <>
            <Input
              readOnly
              value={c.command}
              aria-label="Approval command"
              className="min-w-0 flex-[1_1_320px] font-mono text-[13px]"
              onFocus={(e) => e.currentTarget.select()}
            />
            {prUrl ? (
              <Button type="button" variant="brand" onClick={openPr}>
                Copy &amp; open PR <ExternalLink aria-hidden="true" />
              </Button>
            ) : null}
            <CopyButton value={c.command} variant="outline" labels={{ copy: 'Copy', copied: 'Copied' }}>
              Copy
            </CopyButton>
          </>
        ) : null}
        {c.unpinnable.length > 0 ? (
          <p className="m-0 basis-full text-xs text-muted-foreground">
            {c.unpinnable.length} approved screenshot{c.unpinnable.length === 1 ? ' has' : 's have'} whitespace in the name and
            can't go in a command — tick their boxes in the PR comment, or use Approve all.
          </p>
        ) : null}
        <p className="m-0 hidden flex-1 basis-80 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <ListChecks aria-hidden="true" className="size-4 flex-none" />
          Prefer clicking? The PR comment has a checkbox for every screenshot, plus Approve all — tick them there instead.
        </p>
        <Button type="button" variant="link" size="sm" className="text-muted-foreground" onClick={onReset}>
          Reset review
        </Button>
      </div>
    </div>
  );
}
