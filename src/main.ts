import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { resolveMode } from './mode';
import { compareDirectories } from './diff';
import { generateHtmlReport, generateMarkdownSummary, ReportMeta } from './report';
import { upsertStickyComment, listPrComments } from './comment';
import { parseApprovalCommands, applyApprovals, isApproveComment } from './approvals';
import { findVrtRunsToRerun, rerunFailedJobs, reactToComment } from './approve';
import {
  baselineArtifactName,
  reportArtifactName,
  findBaselineArtifact,
  downloadBaselineArtifact,
  uploadDirectoryAsArtifact,
  uploadFileAsArtifact,
} from './baseline';
import { CompareSummary } from './types';

const KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

async function run(): Promise<void> {
  const token = core.getInput('github-token', { required: true });
  const key = core.getInput('key');
  if (key && !KEY_PATTERN.test(key)) {
    throw new Error(`Invalid key "${key}" — use only letters, digits, ".", "_", "-".`);
  }
  const thresholdRaw = core.getInput('threshold') || '0.1';
  const threshold = parseFloat(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`Invalid threshold "${thresholdRaw}" — must be a number between 0 and 1.`);
  }
  const diffRatioRaw = core.getInput('diff-ratio') || '0';
  const diffRatio = parseFloat(diffRatioRaw);
  if (!Number.isFinite(diffRatio) || diffRatio < 0 || diffRatio > 1) {
    throw new Error(`Invalid diff-ratio "${diffRatioRaw}" — must be a number between 0 and 1.`);
  }
  const failOnDiff = core.getBooleanInput('fail-on-diff');
  const comment = core.getBooleanInput('comment');
  const retentionInput = core.getInput('retention-days');
  let retentionDays = retentionInput ? parseInt(retentionInput, 10) : undefined;
  if (retentionInput && (!Number.isFinite(retentionDays) || (retentionDays as number) < 1)) {
    core.warning(`Invalid retention-days "${retentionInput}" — ignoring it and using the repo default.`);
    retentionDays = undefined;
  }

  const ctx = github.context;
  const { owner, repo } = ctx.repo;
  const defaultBranch: string = ctx.payload.repository?.default_branch ?? 'main';
  const mode = resolveMode(core.getInput('mode') || 'auto', ctx.eventName, ctx.ref, defaultBranch);
  core.info(`Mode: ${mode}`);

  if (mode === 'approve') {
    await runApproveMode(token, owner, repo);
    return;
  }

  const screenshotsDir = core.getInput('screenshots-dir', { required: true });
  if (!fs.existsSync(screenshotsDir)) {
    throw new Error(`screenshots-dir "${screenshotsDir}" does not exist.`);
  }

  if (mode === 'baseline') {
    await uploadDirectoryAsArtifact(baselineArtifactName(key), screenshotsDir, retentionDays);
    core.info(`Published baseline artifact "${baselineArtifactName(key)}" from ${screenshotsDir}`);
    return;
  }

  // --- compare mode ---
  const baselineBranch =
    core.getInput('baseline-branch') || ctx.payload.pull_request?.base?.ref || defaultBranch;
  const octokit = github.getOctokit(token);
  const artifactName = baselineArtifactName(key);
  const ref = await findBaselineArtifact(octokit, owner, repo, artifactName, baselineBranch);

  let baselineDir = '';
  if (ref) {
    baselineDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'vrt-baseline-'));
    await downloadBaselineArtifact(ref, owner, repo, token, baselineDir);
    core.info(`Baseline "${artifactName}" from run ${ref.runId} (branch ${baselineBranch})`);
  } else {
    core.warning(
      `No baseline artifact "${artifactName}" found on branch "${baselineBranch}" — ` +
        'all screenshots will be recorded as new. Baselines publish on the next default-branch build.'
    );
  }

  const summary: CompareSummary = compareDirectories(baselineDir || '/nonexistent-baseline', screenshotsDir, {
    threshold,
    diffRatio,
  });

  const prNumber = ctx.payload.pull_request?.number;
  const headSha = ctx.payload.pull_request?.head?.sha ?? ctx.sha;
  let approved = 0;
  if (prNumber && summary.hasChanges) {
    try {
      const comments = await listPrComments(octokit, owner, repo, prNumber);
      approved = applyApprovals(summary, parseApprovalCommands(comments), headSha);
      if (approved > 0) core.info(`${approved} visual change(s) approved via /vrt approve comments.`);
    } catch (err) {
      core.warning(`Could not read PR comments for approvals: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const meta: ReportMeta = {
    repo: `${owner}/${repo}`,
    runUrl: `https://github.com/${owner}/${repo}/actions/runs/${ctx.runId}`,
    sha: headSha,
    baselineRunUrl: ref?.runUrl,
    missingBaseline: !ref,
    reportArtifactName: reportArtifactName(key),
    prUrl: prNumber ? `https://github.com/${owner}/${repo}/pull/${prNumber}` : undefined,
  };

  let reportPath = '';
  try {
    const reportDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'vrt-report-'));
    reportPath = path.join(reportDir, 'index.html');
    fs.writeFileSync(reportPath, generateHtmlReport(summary, meta));
  } catch (err) {
    core.warning(`Could not generate HTML report: ${err instanceof Error ? err.message : String(err)}`);
    reportPath = '';
  }

  if (reportPath) {
    try {
      const artifactId = await uploadFileAsArtifact(reportArtifactName(key), reportPath, retentionDays);
      if (artifactId) {
        meta.reportDownloadUrl = `${meta.runUrl}/artifacts/${artifactId}`;
      }
    } catch (err) {
      core.warning(`Could not upload report artifact: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const md = generateMarkdownSummary(summary, meta);
  try {
    await core.summary.addRaw(md).write();
  } catch (err) {
    core.warning(`Could not write step summary: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (comment && prNumber) {
    await upsertStickyComment(octokit, owner, repo, prNumber, md, key);
  }

  core.setOutput('changed', String(summary.changed));
  core.setOutput('added', String(summary.added));
  core.setOutput('removed', String(summary.removed));
  core.setOutput('unchanged', String(summary.unchanged));
  core.setOutput('approved', String(approved));
  core.setOutput('has-changes', String(summary.hasChanges));
  core.setOutput('report-path', reportPath);

  core.info(
    `Compared ${summary.results.length} screenshot(s): ` +
      `${summary.changed} changed, ${summary.added} added, ${summary.removed} removed, ` +
      `${summary.unchanged} unchanged, ${approved} approved.`
  );

  const unapproved = summary.changed + summary.removed - approved;
  if (failOnDiff && unapproved > 0) {
    const missing = summary.results
      .filter((r) => (r.status === 'changed' || r.status === 'removed') && !r.approved)
      .map((r) => r.name);
    const missingNote = ` Still needing approval: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` …and ${missing.length - 10} more` : ''}.`;
    core.setFailed(
      `Visual changes detected: ${summary.changed} changed, ${summary.removed} removed (${approved} approved).` +
        missingNote +
        ` Download the "${reportArtifactName(key)}" artifact to review. To accept intentional changes, post a ` +
        `"/vrt approve" command (see the PR comment) covering every changed and removed screenshot. Merging updates the baselines.`
    );
  } else if (failOnDiff && summary.hasChanges) {
    core.info('All visual changes are approved — passing.');
  }
}

async function runApproveMode(token: string, owner: string, repo: string): Promise<void> {
  const ctx = github.context;
  const commentBody: string = ctx.payload.comment?.body ?? '';
  const commentId: number | undefined = ctx.payload.comment?.id;
  const association: string = ctx.payload.comment?.author_association ?? '';
  const prNumber: number | undefined = ctx.payload.issue?.number;

  if (!ctx.payload.issue?.pull_request) {
    core.info('Comment is not on a pull request — nothing to do.');
    return;
  }
  if (!isApproveComment(commentBody)) {
    core.info('Comment is not a /vrt approve command — nothing to do.');
    return;
  }
  if (!['OWNER', 'MEMBER', 'COLLABORATOR'].includes(association)) {
    core.notice(`Ignoring /vrt approve from author_association "${association}" — approvals require write access.`);
    return;
  }
  if (!prNumber) {
    core.info('No PR number in the event payload — nothing to do.');
    return;
  }

  const octokit = github.getOctokit(token);
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const runs = await findVrtRunsToRerun(octokit, owner, repo, pr.head.sha);
  if (runs.length === 0) {
    core.info('No failed visual-regression runs found for the PR head — nothing to rerun.');
    return;
  }
  for (const runId of runs) {
    await rerunFailedJobs(octokit, owner, repo, runId);
    core.info(`Rerunning failed jobs of run ${runId} to re-evaluate approvals.`);
  }
  if (commentId) await reactToComment(octokit, owner, repo, commentId);
}

run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
