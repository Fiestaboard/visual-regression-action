import { createHash } from 'crypto';
import { CompareSummary } from './types';

/** Associations allowed to approve visual changes via PR comment. */
const AUTHORIZED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** 12-hex-char content hash used to pin an approval to exact pixels. */
export function shortHash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

export function isApproveComment(body: string): boolean {
  return /^\s*\/vrt\s+approve\b/.test(body);
}

export interface ApprovalSet {
  /** screenshot name → approved content hashes */
  entries: Map<string, string[]>;
  /** head-sha pins from `all@<sha>` (min 7 chars) */
  allShas: string[];
  /** created_at timestamps of bare `all` commands (valid only while their head is current) */
  allTimestamps: string[];
}

interface CommentLike {
  body?: string;
  author_association?: string;
  created_at?: string;
  user?: { login?: string } | null;
}

/** Only the bot-authored report comment may carry trusted approval checkboxes:
 * GitHub restricts editing others' comments (ticking a box) to users with write
 * access, so a checked box implies an authorized approver. */
const CHECKBOX_AUTHOR = 'github-actions[bot]';
// Anchored to the start of a line: only the bot's own list items count, never
// text that happens to appear inside a (screenshot-name-controlled) line.
const CHECKED_BOX = /^- \[x\] <!-- vrt:approve-all@([0-9a-f]{7,40}) -->/gim;
/** Per-screenshot box: `- [ ] <!-- vrt:approve@<sha>:<encoded name> -->`. */
const ITEM_BOX = /^- \[([ xX])\] <!-- vrt:approve@([0-9a-f]{7,40}):([^\s>]+) -->/gm;

/**
 * Screenshot names are URI-encoded inside the checkbox's HTML comment, with
 * "-" encoded too so a name can never form "--" or "-->" and end the comment.
 */
export function encodeItemMarker(name: string): string {
  return encodeURIComponent(name).replace(/-/g, '%2D');
}

function decodeItemMarker(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function checkboxPin(body: string): string | null {
  const m = /^- \[x\] <!-- vrt:approve-all@([0-9a-f]{7,40}) -->/im.exec(body);
  return m ? m[1].toLowerCase() : null;
}

export interface CheckboxItem {
  name: string;
  pin: string;
  checked: boolean;
}

/** Every per-screenshot approval checkbox in a report comment, ticked or not. */
export function checkboxItems(body: string): CheckboxItem[] {
  const out: CheckboxItem[] = [];
  for (const m of body.matchAll(ITEM_BOX)) {
    const name = decodeItemMarker(m[3]);
    if (name === null) continue;
    out.push({ name, pin: m[2].toLowerCase(), checked: m[1] !== ' ' });
  }
  return out;
}

export type BoxTick =
  | { kind: 'none' }
  | { kind: 'partial'; ticked: number; total: number }
  | { kind: 'complete'; command: string };

/**
 * What an edit to the report comment amounts to. "complete" means a rerun
 * can pass: Approve all is ticked, or every per-screenshot box is. A partly
 * ticked list can't pass yet, so it isn't worth a rerun.
 */
export function boxTick(body: string): BoxTick {
  const allPin = checkboxPin(body);
  if (allPin !== null) return { kind: 'complete', command: `/vrt approve all@${allPin}` };
  const items = checkboxItems(body);
  const ticked = items.filter((i) => i.checked).length;
  if (ticked === 0) return { kind: 'none' };
  if (ticked < items.length) return { kind: 'partial', ticked, total: items.length };
  return { kind: 'complete', command: `/vrt approve ${items.map((i) => `${i.name}@${i.pin}`).join(' ')}` };
}

export function parseApprovalCommands(comments: CommentLike[]): ApprovalSet {
  const entries = new Map<string, string[]>();
  const allShas: string[] = [];
  const allTimestamps: string[] = [];
  for (const c of comments) {
    if (!c.body) continue;
    if (c.user?.login === CHECKBOX_AUTHOR) {
      for (const m of c.body.matchAll(CHECKED_BOX)) allShas.push(m[1].toLowerCase());
      for (const item of checkboxItems(c.body)) {
        if (!item.checked) continue;
        const list = entries.get(item.name) ?? [];
        list.push(item.pin);
        entries.set(item.name, list);
      }
    }
    if (!isApproveComment(c.body) || !AUTHORIZED.has(c.author_association ?? '')) continue;
    const tokens = c.body.replace(/^\s*\/vrt\s+approve\b/, '').trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (token === 'all') {
        if (c.created_at) allTimestamps.push(c.created_at);
        continue;
      }
      const at = token.lastIndexOf('@');
      if (at <= 0 || at === token.length - 1) continue;
      const name = token.slice(0, at);
      const pin = token.slice(at + 1).toLowerCase();
      if (name === 'all') {
        if (/^[0-9a-f]{7,40}$/.test(pin)) allShas.push(pin);
      } else if (/^[0-9a-f]{7,40}$/.test(pin)) {
        const list = entries.get(name) ?? [];
        list.push(pin);
        entries.set(name, list);
      }
    }
  }
  return { entries, allShas, allTimestamps };
}

/**
 * Marks changed/removed screenshots as approved when a comment pinned their
 * exact content or the whole head — via `all@<sha>`, or a bare `all` posted
 * after the head commit (so any newer push invalidates it). Returns the
 * approved count.
 */
export function applyApprovals(
  summary: CompareSummary,
  approvals: ApprovalSet,
  headSha: string,
  headCommittedAt?: string
): number {
  const headMatch =
    approvals.allShas.some((s) => headSha.toLowerCase().startsWith(s)) ||
    (!!headCommittedAt && approvals.allTimestamps.some((t) => t >= headCommittedAt));
  let approved = 0;
  const head = headSha.toLowerCase();
  for (const r of summary.results) {
    if (r.status !== 'changed' && r.status !== 'removed') continue;
    const buf = r.status === 'changed' ? r.currentPng : r.baselinePng;
    if (!buf) continue;
    const contentHash = shortHash(buf);
    // A per-file pin is either a commit-sha prefix (robust against capture
    // noise; any push invalidates it) or a legacy exact content hash.
    const pinMatch = (approvals.entries.get(r.name) ?? []).some(
      (pin) => head.startsWith(pin) || pin === contentHash
    );
    if (headMatch || pinMatch) {
      r.approved = true;
      approved++;
    }
  }
  return approved;
}
