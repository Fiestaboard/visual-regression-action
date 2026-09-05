import * as core from '@actions/core';

export const COMMENT_MARKER = '<!-- fiestaboard/visual-regression-action -->';

export function commentMarker(key: string): string {
  return key ? `<!-- fiestaboard/visual-regression-action:${key} -->` : COMMENT_MARKER;
}

interface MinimalOctokit {
  rest: {
    issues: {
      listComments: (p: {
        owner: string;
        repo: string;
        issue_number: number;
        per_page: number;
        page: number;
      }) => Promise<{ data: Array<{ id: number; body?: string; author_association?: string; created_at?: string }> }>;
      createComment: (p: { owner: string; repo: string; issue_number: number; body: string }) => Promise<unknown>;
      updateComment: (p: { owner: string; repo: string; comment_id: number; body: string }) => Promise<unknown>;
    };
  };
}

const MAX_COMMENT_PAGES = 10;

async function findMarkedComment(
  octokit: MinimalOctokit,
  owner: string,
  repo: string,
  prNumber: number,
  marker: string
): Promise<{ id: number; body?: string } | undefined> {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const { data } = await octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100, page });
    const existing = data.find((c) => c.body?.includes(marker));
    if (existing) return existing;
    if (data.length < 100) return undefined;
  }
  return undefined;
}

/** All PR comments (paginated, capped) — used to collect /vrt approve commands. */
export async function listPrComments(
  octokit: MinimalOctokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Array<{ id: number; body?: string; author_association?: string; created_at?: string }>> {
  const out: Array<{ id: number; body?: string; author_association?: string; created_at?: string }> = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const { data } = await octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100, page });
    out.push(...data);
    if (data.length < 100) break;
  }
  return out;
}

/** Marker for the approval-status comment that narrates the approve → rerun → outcome loop. */
export const STATUS_MARKER = '<!-- fiestaboard/visual-regression-action:approval-status -->';

/**
 * Creates or updates the single comment carrying `marker`. With
 * createIfMissing=false it only updates an existing comment. Errors are
 * swallowed with a warning (fork PRs / missing permission). Returns true
 * when a comment was written.
 */
export async function upsertMarkedComment(
  octokit: MinimalOctokit,
  owner: string,
  repo: string,
  prNumber: number,
  marker: string,
  body: string,
  createIfMissing = true
): Promise<boolean> {
  const full = `${marker}\n${body}`;
  try {
    const existing = await findMarkedComment(octokit, owner, repo, prNumber, marker);
    if (existing) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: full });
      return true;
    }
    if (createIfMissing) {
      await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: full });
      return true;
    }
    return false;
  } catch (err) {
    core.warning(`Could not post PR comment (fork PR or missing pull-requests: write permission): ${err}`);
    return false;
  }
}

export async function upsertStickyComment(
  octokit: MinimalOctokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  key: string
): Promise<void> {
  await upsertMarkedComment(octokit, owner, repo, prNumber, commentMarker(key), body);
}
