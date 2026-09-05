import * as path from 'path';
import { DefaultArtifactClient } from '@actions/artifact';
import { listPngs } from './diff';

export function baselineArtifactName(key: string): string {
  return key ? `vrt-baseline-${key}` : 'vrt-baseline';
}

export function reportArtifactName(key: string): string {
  return key ? `vrt-report-${key}` : 'vrt-report';
}

export interface BaselineRef {
  artifactId: number;
  runId: number;
  runUrl: string;
}

interface ArtifactListItem {
  id: number;
  name: string;
  expired: boolean;
  created_at: string | null;
  workflow_run?: { id?: number; head_branch?: string } | null;
}

interface ArtifactOctokit {
  rest: {
    actions: {
      listArtifactsForRepo: (p: {
        owner: string;
        repo: string;
        name: string;
        per_page: number;
      }) => Promise<{ data: { artifacts: ArtifactListItem[] } }>;
    };
  };
}

export async function findBaselineArtifact(
  octokit: ArtifactOctokit,
  owner: string,
  repo: string,
  name: string,
  branch: string
): Promise<BaselineRef | null> {
  const { data } = await octokit.rest.actions.listArtifactsForRepo({ owner, repo, name, per_page: 100 });
  const match = data.artifacts
    .filter((a) => a.name === name && !a.expired && a.workflow_run?.head_branch === branch && a.workflow_run?.id)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
  if (!match) return null;
  const runId = match.workflow_run!.id!;
  return { artifactId: match.id, runId, runUrl: `https://github.com/${owner}/${repo}/actions/runs/${runId}` };
}

export async function downloadBaselineArtifact(
  ref: BaselineRef,
  owner: string,
  repo: string,
  token: string,
  destDir: string
): Promise<void> {
  const client = new DefaultArtifactClient();
  await client.downloadArtifact(ref.artifactId, {
    path: destDir,
    findBy: { token, workflowRunId: ref.runId, repositoryOwner: owner, repositoryName: repo },
  });
}

export async function uploadDirectoryAsArtifact(name: string, dir: string, retentionDays?: number): Promise<void> {
  const client = new DefaultArtifactClient();
  const files = listPngs(dir).map((rel) => path.join(dir, rel));
  if (files.length === 0) throw new Error(`No .png files found in "${dir}" — nothing to upload.`);
  await client.uploadArtifact(name, files, dir, retentionDays ? { retentionDays } : {});
}

export async function uploadFileAsArtifact(name: string, filePath: string, retentionDays?: number): Promise<void> {
  const client = new DefaultArtifactClient();
  await client.uploadArtifact(name, [filePath], path.dirname(filePath), retentionDays ? { retentionDays } : {});
}
