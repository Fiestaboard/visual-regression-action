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
}

export function parseApprovalCommands(comments: CommentLike[]): ApprovalSet {
  const entries = new Map<string, string[]>();
  const allShas: string[] = [];
  const allTimestamps: string[] = [];
  for (const c of comments) {
    if (!c.body || !isApproveComment(c.body) || !AUTHORIZED.has(c.author_association ?? '')) continue;
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
