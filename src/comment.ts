import * as core from '@actions/core';

export const COMMENT_MARKER = '<!-- fiestaboard/visual-regression-action -->';

interface MinimalOctokit {
  rest: {
    issues: {
      listComments: (p: { owner: string; repo: string; issue_number: number; per_page: number }) => Promise<{ data: Array<{ id: number; body?: string }> }>;
      createComment: (p: { owner: string; repo: string; issue_number: number; body: string }) => Promise<unknown>;
      updateComment: (p: { owner: string; repo: string; comment_id: number; body: string }) => Promise<unknown>;
    };
  };
}

export async function upsertStickyComment(
  octokit: MinimalOctokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const full = `${COMMENT_MARKER}\n${body}`;
  try {
    const { data } = await octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100 });
    const existing = data.find((c) => c.body?.includes(COMMENT_MARKER));
    if (existing) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: full });
    } else {
      await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: full });
    }
  } catch (err) {
    core.warning(`Could not post PR comment (fork PR or missing pull-requests: write permission): ${err}`);
  }
}
