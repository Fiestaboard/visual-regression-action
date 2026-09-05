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
      }) => Promise<{ data: Array<{ id: number; body?: string; author_association?: string }> }>;
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
): Promise<Array<{ id: number; body?: string; author_association?: string }>> {
  const out: Array<{ id: number; body?: string; author_association?: string }> = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const { data } = await octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100, page });
    out.push(...data);
    if (data.length < 100) break;
  }
  return out;
}

export async function upsertStickyComment(
  octokit: MinimalOctokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  key: string
): Promise<void> {
  const marker = commentMarker(key);
  const full = `${marker}\n${body}`;
  try {
    const existing = await findMarkedComment(octokit, owner, repo, prNumber, marker);
    if (existing) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: full });
    } else {
      await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: full });
    }
  } catch (err) {
    core.warning(`Could not post PR comment (fork PR or missing pull-requests: write permission): ${err}`);
  }
}
