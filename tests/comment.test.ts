import { describe, it, expect, vi } from 'vitest';
import { upsertStickyComment, commentMarker, COMMENT_MARKER } from '../src/comment';

function mockOctokit(existing: Array<{ id: number; body?: string }>) {
  return {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: existing }),
        createComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
      },
    },
  };
}

describe('commentMarker', () => {
  it('is the bare marker when key is empty', () => {
    expect(commentMarker('')).toBe(COMMENT_MARKER);
  });

  it('embeds the key when given', () => {
    expect(commentMarker('web')).toBe('<!-- fiestaboard/visual-regression-action:web -->');
    expect(commentMarker('admin')).toBe('<!-- fiestaboard/visual-regression-action:admin -->');
  });
});

describe('upsertStickyComment', () => {
  it('creates a marked comment when none exists', async () => {
    const ok = mockOctokit([{ id: 1, body: 'unrelated' }]);
    await upsertStickyComment(ok as never, 'o', 'r', 5, 'hello', '');
    expect(ok.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'o', repo: 'r', issue_number: 5, body: expect.stringContaining(COMMENT_MARKER) })
    );
    expect(ok.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it('updates the existing marked comment', async () => {
    const ok = mockOctokit([{ id: 9, body: `${COMMENT_MARKER}\nold` }]);
    await upsertStickyComment(ok as never, 'o', 'r', 5, 'new', '');
    expect(ok.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 9, body: expect.stringContaining('new') })
    );
    expect(ok.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('swallows errors (fork PRs) with a warning instead of throwing', async () => {
    const ok = mockOctokit([]);
    ok.rest.issues.createComment.mockRejectedValue(new Error('Resource not accessible by integration'));
    await expect(upsertStickyComment(ok as never, 'o', 'r', 5, 'x', '')).resolves.toBeUndefined();
  });

  it('creates a new comment for a distinct key instead of clobbering the unkeyed comment', async () => {
    const ok = mockOctokit([{ id: 1, body: `${COMMENT_MARKER}\nunkeyed report` }]);
    await upsertStickyComment(ok as never, 'o', 'r', 5, 'web report', 'web');
    expect(ok.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining(commentMarker('web')) })
    );
    expect(ok.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it('updates only the comment matching its own key', async () => {
    const ok = mockOctokit([
      { id: 1, body: `${commentMarker('admin')}\nadmin report` },
      { id: 2, body: `${commentMarker('web')}\nweb report` },
    ]);
    await upsertStickyComment(ok as never, 'o', 'r', 5, 'new web report', 'web');
    expect(ok.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 2, body: expect.stringContaining('new web report') })
    );
    expect(ok.rest.issues.createComment).not.toHaveBeenCalled();
  });
});
