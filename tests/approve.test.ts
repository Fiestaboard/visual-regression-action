import { describe, it, expect, vi } from 'vitest';
import { findVrtRunsToRerun, approvalReceivedBody } from '../src/approve';

describe('approvalReceivedBody', () => {
  it('names the approver, echoes the request, and links the rerun', () => {
    const body = approvalReceivedBody('jeffredodd', '/vrt approve home.png@abc1234 all', [
      'https://github.com/o/r/actions/runs/1',
    ]);
    expect(body).toContain('### Approval received');
    expect(body).toContain('👀');
    expect(body).toContain('@jeffredodd');
    expect(body).toContain('`home.png@abc1234`');
    expect(body).toContain('`all`');
    expect(body).toContain('https://github.com/o/r/actions/runs/1');
    expect(body).toContain('updates with the result');
  });

  it('explains when there is nothing to rerun', () => {
    const body = approvalReceivedBody('jeffredodd', '/vrt approve all', []);
    expect(body).toContain('nothing to rerun');
  });
});

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
