import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { resolveMode } from './mode';
import { compareDirectories } from './diff';
import { generateHtmlReport, generateMarkdownSummary, ReportMeta } from './report';
import { upsertStickyComment } from './comment';
import {
  baselineArtifactName,
  reportArtifactName,
  findBaselineArtifact,
  downloadBaselineArtifact,
  uploadDirectoryAsArtifact,
  uploadFileAsArtifact,
} from './baseline';
import { CompareSummary } from './types';

async function run(): Promise<void> {
  const screenshotsDir = core.getInput('screenshots-dir', { required: true });
  const token = core.getInput('github-token', { required: true });
  const key = core.getInput('key');
  const threshold = parseFloat(core.getInput('threshold') || '0.1');
  const diffRatio = parseFloat(core.getInput('diff-ratio') || '0');
  const failOnDiff = core.getBooleanInput('fail-on-diff');
  const comment = core.getBooleanInput('comment');
  const retentionInput = core.getInput('retention-days');
  const retentionDays = retentionInput ? parseInt(retentionInput, 10) : undefined;

  const ctx = github.context;
  const { owner, repo } = ctx.repo;
  const defaultBranch: string = ctx.payload.repository?.default_branch ?? 'main';
  const mode = resolveMode(core.getInput('mode') || 'auto', ctx.eventName, ctx.ref, defaultBranch);
  core.info(`Mode: ${mode}`);

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

  const meta: ReportMeta = {
    repo: `${owner}/${repo}`,
    runUrl: `https://github.com/${owner}/${repo}/actions/runs/${ctx.runId}`,
    sha: ctx.payload.pull_request?.head?.sha ?? ctx.sha,
    baselineRunUrl: ref?.runUrl,
    missingBaseline: !ref,
  };

  const reportDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'vrt-report-'));
  const reportPath = path.join(reportDir, 'index.html');
  fs.writeFileSync(reportPath, generateHtmlReport(summary, meta));
  await uploadFileAsArtifact(reportArtifactName(key), reportPath, retentionDays);

  const md = generateMarkdownSummary(summary, meta);
  await core.summary.addRaw(md).write();

  const prNumber = ctx.payload.pull_request?.number;
  if (comment && prNumber) {
    await upsertStickyComment(octokit, owner, repo, prNumber, md);
  }

  core.setOutput('changed', String(summary.changed));
  core.setOutput('added', String(summary.added));
  core.setOutput('removed', String(summary.removed));
  core.setOutput('unchanged', String(summary.unchanged));
  core.setOutput('has-changes', String(summary.hasChanges));
  core.setOutput('report-path', reportPath);

  core.info(
    `Compared ${summary.results.length} screenshot(s): ` +
      `${summary.changed} changed, ${summary.added} added, ${summary.removed} removed, ${summary.unchanged} unchanged.`
  );

  if (failOnDiff && summary.hasChanges) {
    core.setFailed(
      `Visual changes detected: ${summary.changed} changed, ${summary.removed} removed. ` +
        `Download the "${reportArtifactName(key)}" artifact to review. Merging this PR updates the baselines.`
    );
  }
}

run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
