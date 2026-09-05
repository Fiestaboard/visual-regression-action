import { describe, it, expect, vi } from 'vitest';
import { baselineArtifactName, reportArtifactName, findBaselineArtifact } from '../src/baseline';

describe('artifact names', () => {
  it('suffixes only when a key is given', () => {
    expect(baselineArtifactName('')).toBe('vrt-baseline');
    expect(baselineArtifactName('web')).toBe('vrt-baseline-web');
    expect(reportArtifactName('')).toBe('vrt-report');
    expect(reportArtifactName('web')).toBe('vrt-report-web');
  });
});

function mockOctokit(artifacts: unknown[]) {
  return {
    rest: {
      actions: {
        listArtifactsForRepo: vi.fn().mockResolvedValue({ data: { artifacts } }),
      },
    },
  } as never;
}

function mockPagedOctokit(pages: unknown[][]) {
  const listArtifactsForRepo = vi.fn().mockImplementation(({ page }: { page: number }) => {
    const artifacts = pages[page - 1] ?? [];
    return Promise.resolve({ data: { artifacts } });
  });
  return { rest: { actions: { listArtifactsForRepo } } } as never;
}

const art = (over: Record<string, unknown>) => ({
  id: 1,
  name: 'vrt-baseline',
  expired: false,
  created_at: '2026-09-01T00:00:00Z',
  workflow_run: { id: 100, head_branch: 'main' },
  ...over,
});

describe('findBaselineArtifact', () => {
  it('returns the newest matching artifact on the branch', async () => {
    const ok = mockOctokit([
      art({ id: 2, created_at: '2026-09-02T00:00:00Z', workflow_run: { id: 200, head_branch: 'main' } }),
      art({ id: 1, created_at: '2026-09-01T00:00:00Z' }),
    ]);
    const ref = await findBaselineArtifact(ok, 'o', 'r', 'vrt-baseline', 'main');
    expect(ref).toEqual({ artifactId: 2, runId: 200, runUrl: 'https://github.com/o/r/actions/runs/200' });
  });

  it('skips expired artifacts and other branches', async () => {
    const ok = mockOctokit([
      art({ id: 3, expired: true }),
      art({ id: 4, workflow_run: { id: 400, head_branch: 'other' } }),
    ]);
    expect(await findBaselineArtifact(ok, 'o', 'r', 'vrt-baseline', 'main')).toBeNull();
  });

  it('returns null when nothing matches', async () => {
    expect(await findBaselineArtifact(mockOctokit([]), 'o', 'r', 'vrt-baseline', 'main')).toBeNull();
  });

  it('finds a match on page 2 when page 1 is full of other-branch artifacts', async () => {
    const otherBranchPage = Array.from({ length: 100 }, (_, i) =>
      art({ id: i + 1, created_at: `2026-09-01T00:00:0${i % 10}Z`, workflow_run: { id: i + 1, head_branch: 'other' } })
    );
    const page2 = [art({ id: 999, created_at: '2026-08-01T00:00:00Z', workflow_run: { id: 999, head_branch: 'release' } })];
    const ok = mockPagedOctokit([otherBranchPage, page2]);
    const ref = await findBaselineArtifact(ok, 'o', 'r', 'vrt-baseline', 'release');
    expect(ref).toEqual({ artifactId: 999, runId: 999, runUrl: 'https://github.com/o/r/actions/runs/999' });
    expect((ok as { rest: { actions: { listArtifactsForRepo: ReturnType<typeof vi.fn> } } }).rest.actions.listArtifactsForRepo).toHaveBeenCalledTimes(2);
  });

  it('gives up after 10 pages with no match', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) =>
      art({ id: i + 1, workflow_run: { id: i + 1, head_branch: 'other' } })
    );
    const pages = Array.from({ length: 10 }, () => fullPage);
    const ok = mockPagedOctokit(pages);
    const ref = await findBaselineArtifact(ok, 'o', 'r', 'vrt-baseline', 'release');
    expect(ref).toBeNull();
    expect((ok as { rest: { actions: { listArtifactsForRepo: ReturnType<typeof vi.fn> } } }).rest.actions.listArtifactsForRepo).toHaveBeenCalledTimes(10);
  });
});
