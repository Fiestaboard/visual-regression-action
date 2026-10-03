export interface RetryOptions {
  /** Total tries, including the first. */
  attempts?: number;
  /** Pause before the second try; doubles for each try after that. */
  delayMs?: number;
}

/**
 * Whether asking again could change the answer.
 *
 * A network failure (no HTTP status at all) or a 5xx can. A 4xx cannot: the
 * token still lacks the scope and the PR still does not exist, so retrying
 * only delays the real error.
 */
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status !== 'number' || status >= 500;
}

/**
 * Run `fn`, retrying failures that a second attempt can plausibly fix.
 *
 * Exists for one case in particular. Compare mode pixel-diffs every
 * screenshot synchronously, and on a large suite that blocks the event loop
 * for the better part of a minute. The API connection opened before the diff
 * sits idle past its keep-alive, the server closes it, and the first request
 * afterwards goes out on the dead socket and fails with "other side closed".
 * The failed request is what makes the client drop that socket, so the very
 * next attempt opens a fresh one and succeeds.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? 500;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) throw err;
      const wait = delayMs * 2 ** (attempt - 1);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
