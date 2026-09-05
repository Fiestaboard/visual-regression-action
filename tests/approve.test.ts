import { describe, it, expect, vi } from 'vitest';
import { findVrtRunsToRerun } from '../src/approve';

function mockOctokit(runs: unknown[], artifactsByRun: Record<number, string[]>) {
  return {
    rest: {
      actions: {
        listWorkflowRunsForRepo: vi.fn().mockResolvedValue({ data: { workflow_runs: runs } }),
        listWorkflowRunArtifacts: vi.fn().mockImplementation(({ run_id }: { run_id: number }) =>
          Promise.resolve({ data: { artifacts: (artifactsByRun[run_id] ?? []).map((name) => ({ name })) } })
        ),
      },
    },
  } as never;
}

const run = (id: number, conclusion: string) => ({ id, status: 'completed', conclusion });

describe('findVrtRunsToRerun', () => {
  it('returns failed runs that produced a vrt-report artifact', async () => {
    const ok = mockOctokit(
      [run(1, 'failure'), run(2, 'failure'), run(3, 'success')],
      { 1: ['vrt-report-demo'], 2: ['coverage'], 3: ['vrt-report'] }
    );
    expect(await findVrtRunsToRerun(ok, 'o', 'r', 'headsha')).toEqual([1]);
  });

  it('returns [] when nothing failed or nothing is a VRT run', async () => {
    const ok = mockOctokit([run(3, 'success')], { 3: ['vrt-report'] });
    expect(await findVrtRunsToRerun(ok, 'o', 'r', 'headsha')).toEqual([]);
  });
});
