import { describe, it, expect, vi } from 'vitest';
import { listPrComments } from '../src/comment';
import { withRetry } from '../src/retry';

/** What undici throws when a request goes out on a keep-alive socket the server already closed. */
function socketClosed(): Error {
  return new Error('other side closed');
}

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe('withRetry', () => {
  it('returns the first result without retrying when the call succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure and returns the eventual result', async () => {
    const fn = vi.fn().mockRejectedValueOnce(socketClosed()).mockResolvedValue('ok');
    await expect(withRetry(fn, { delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx response', async () => {
    const fn = vi.fn().mockRejectedValueOnce(httpError(502)).mockResolvedValue('ok');
    await expect(withRetry(fn, { delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx response — asking again cannot change the answer', async () => {
    const fn = vi.fn().mockRejectedValue(httpError(403));
    await expect(withRetry(fn, { delayMs: 0 })).rejects.toThrow('HTTP 403');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last attempt and throws that error', async () => {
    const fn = vi.fn().mockRejectedValue(socketClosed());
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).rejects.toThrow('other side closed');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('listPrComments', () => {
  const comment = { id: 1, body: '/vrt approve all', author_association: 'OWNER' };

  function octokitWith(listComments: ReturnType<typeof vi.fn>) {
    return { rest: { issues: { listComments, createComment: vi.fn(), updateComment: vi.fn() } } };
  }

  it('survives the first request landing on a closed socket', async () => {
    // The failure this guards: compare mode pixel-diffs every screenshot
    // synchronously, the API connection idles past its keep-alive while it
    // does, and the very next request — this one — goes out on a socket the
    // server has already closed. Unretried, the read fails, zero approvals
    // are counted, and an approved PR can never go green.
    const listComments = vi.fn().mockRejectedValueOnce(socketClosed()).mockResolvedValue({ data: [comment] });
    await expect(listPrComments(octokitWith(listComments) as never, 'o', 'r', 5, { delayMs: 0 })).resolves.toEqual([
      comment,
    ]);
    expect(listComments).toHaveBeenCalledTimes(2);
  });

  it('retries the page that failed, not the pages before it', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: i, body: 'x' }));
    const listComments = vi
      .fn()
      .mockResolvedValueOnce({ data: fullPage })
      .mockRejectedValueOnce(socketClosed())
      .mockResolvedValue({ data: [comment] });
    const out = await listPrComments(octokitWith(listComments) as never, 'o', 'r', 5, { delayMs: 0 });
    expect(out).toHaveLength(101);
    expect(listComments.mock.calls.map(([p]) => p.page)).toEqual([1, 2, 2]);
  });

  it('still fails when the API keeps failing', async () => {
    const listComments = vi.fn().mockRejectedValue(socketClosed());
    await expect(listPrComments(octokitWith(listComments) as never, 'o', 'r', 5, { delayMs: 0 })).rejects.toThrow(
      'other side closed'
    );
  });
});
