import type { ReportItem, ReportStatus } from '../../src/report-data';

/** A reviewer's local verdict per screenshot name: true approve, false reject. */
export type Decisions = Record<string, boolean>;

export const STATUS_ORDER: ReportStatus[] = ['changed', 'added', 'removed', 'unchanged'];

export const STATUS_LABEL: Record<ReportStatus, string> = {
  changed: 'Changed',
  added: 'Added',
  removed: 'Removed',
  unchanged: 'Unchanged',
};

/** Only changed and removed screenshots gate the check, so only they take a verdict. */
export function isVotable(item: ReportItem): boolean {
  return item.status === 'changed' || item.status === 'removed';
}

/** Already approved on the PR: counts as approved, and the verdict is locked. */
export function isLocked(item: ReportItem): boolean {
  return isVotable(item) && item.approved;
}

/** The effective verdict: PR approvals win; otherwise the local decision, if any. */
export function verdict(item: ReportItem, decisions: Decisions): boolean | null {
  if (!isVotable(item)) return null;
  if (item.approved) return true;
  const d = decisions[item.name];
  return d === true || d === false ? d : null;
}

export const pct = (ratio: number): string => `${(ratio * 100).toFixed(2)}%`;

export type CoverageState = 'idle' | 'rejected-only' | 'partial' | 'with-rejections' | 'complete' | 'nothing';

export interface Coverage {
  state: CoverageState;
  /** Changed + removed screenshots. */
  total: number;
  /** Approved, counting both PR approvals and local ones. */
  approved: number;
  rejected: number;
  unreviewed: number;
  /** Screenshots already approved on the PR. */
  approvedOnPr: number;
  /** The /vrt approve command for local approvals not yet on the PR ('' when there are none). */
  command: string;
  /** Approved names that cannot go in a command (whitespace); they need approve-all. */
  unpinnable: string[];
}

export function coverage(items: ReportItem[], decisions: Decisions, pin: string): Coverage {
  const votable = items.filter(isVotable);
  let approved = 0;
  let rejected = 0;
  let approvedOnPr = 0;
  const entries: string[] = [];
  const unpinnable: string[] = [];
  for (const item of votable) {
    const v = verdict(item, decisions);
    if (v === true) {
      approved++;
      if (item.approved) approvedOnPr++;
      else if (/\s/.test(item.name)) unpinnable.push(item.name);
      else entries.push(`${item.name}@${pin}`);
    } else if (v === false) {
      rejected++;
    }
  }
  const total = votable.length;
  const unreviewed = total - approved - rejected;
  const fresh = approved - approvedOnPr;
  let state: CoverageState;
  if (total === 0) state = 'nothing';
  else if (fresh === 0 && rejected === 0) state = 'idle';
  else if (fresh === 0) state = 'rejected-only';
  else if (unreviewed > 0) state = 'partial';
  else if (rejected > 0) state = 'with-rejections';
  else state = 'complete';
  return {
    state,
    total,
    approved,
    rejected,
    unreviewed,
    approvedOnPr,
    command: entries.length ? `/vrt approve ${entries.join(' ')}` : '',
    unpinnable,
  };
}

export function sortItems(items: ReportItem[], order: 'review' | 'ratio'): ReportItem[] {
  const review = (a: ReportItem, b: ReportItem) =>
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name);
  return [...items].sort(order === 'ratio' ? (a, b) => b.diffRatio - a.diffRatio || review(a, b) : review);
}

export function storeKey(runUrl: string): string {
  return `vrt-review:${runUrl}`;
}

export function loadDecisions(runUrl: string): Decisions {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(runUrl)) || '{}');
    const out: Decisions = {};
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) if (v === true || v === false) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDecisions(runUrl: string, decisions: Decisions): void {
  try {
    if (Object.keys(decisions).length === 0) localStorage.removeItem(storeKey(runUrl));
    else localStorage.setItem(storeKey(runUrl), JSON.stringify(decisions));
  } catch {
    /* storage unavailable (private window, file:// policy) — decisions live for this visit only */
  }
}
