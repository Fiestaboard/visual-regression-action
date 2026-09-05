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
});
