import * as core from '@actions/core';

interface RunListItem {
  id: number;
  status: string | null;
  conclusion: string | null;
}

interface ApproveOctokit {
  rest: {
    actions: {
      listWorkflowRunsForRepo: (p: {
        owner: string;
        repo: string;
        head_sha: string;
        per_page: number;
      }) => Promise<{ data: { workflow_runs: RunListItem[] } }>;
      listWorkflowRunArtifacts: (p: {
        owner: string;
        repo: string;
        run_id: number;
      }) => Promise<{ data: { artifacts: Array<{ name: string }> } }>;
    };
  };
  request: (route: string, params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Failed, completed runs on the PR head that uploaded a vrt-report artifact —
 * i.e. the visual-regression checks worth rerunning after an approval.
 */
export async function findVrtRunsToRerun(
  octokit: ApproveOctokit,
  owner: string,
  repo: string,
  headSha: string
): Promise<number[]> {
  const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo, head_sha: headSha, per_page: 50 });
  const failed = data.workflow_runs.filter((r) => r.status === 'completed' && r.conclusion === 'failure');
  const out: number[] = [];
  for (const r of failed) {
    const { data: arts } = await octokit.rest.actions.listWorkflowRunArtifacts({ owner, repo, run_id: r.id });
    if (arts.artifacts.some((a) => a.name.startsWith('vrt-report'))) out.push(r.id);
  }
  return out;
}

export async function rerunFailedJobs(octokit: ApproveOctokit, owner: string, repo: string, runId: number): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs', {
    owner,
    repo,
    run_id: runId,
  });
}

/** Best-effort 🚀 reaction on the approval comment so the commenter sees it landed. */
export async function reactToComment(
  octokit: ApproveOctokit,
  owner: string,
  repo: string,
  commentId: number
): Promise<void> {
  try {
    await octokit.request('POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions', {
      owner,
      repo,
      comment_id: commentId,
      content: 'rocket',
    });
  } catch (err) {
    core.warning(`Could not react to the approval comment: ${err instanceof Error ? err.message : String(err)}`);
  }
}
