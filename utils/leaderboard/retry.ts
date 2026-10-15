/** Retries of transient source errors for the leaderboard fetchers (pure, no I/O of its own). */

/** Waits before the second and third attempt */
export const RETRY_DELAYS_MS = [1_000, 3_000];

/** An HTTP answer that was not `2xx`, from a plain `fetch` */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

const isRetryableStatus = (status: unknown) =>
  typeof status === 'number' && (status >= 500 || status === 429);

/**
 * Whether another attempt may succeed: a `5xx` or `429` answer (from `fetch` or
 * graphql-request's `ClientError`), a timeout, or a network error. A `200` carrying GraphQL
 * errors and any other `4xx` are not retried.
 */
export const isTransientError = (error: unknown): boolean => {
  if (error instanceof HttpStatusError) return isRetryableStatus(error.status);
  if (!(error instanceof Error)) return false;
  const { response } = error as { response?: { status?: unknown } };
  if (response) return isRetryableStatus(response.status);
  // `AbortSignal.timeout` and undici's network failures (`fetch failed`)
  return error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError;
};

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt`, retrying transient errors after each of `delays`, as long as the retry would
 * still start before `deadline` (epoch ms); otherwise the last error is thrown.
 */
export const withRetry = async <T>(
  attempt: () => Promise<T>,
  {
    deadline,
    delays = RETRY_DELAYS_MS,
    isRetryable = isTransientError,
    sleep = sleepMs,
  }: {
    deadline: number;
    delays?: number[];
    isRetryable?: (error: unknown) => boolean;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> => {
  for (let retry = 0; ; retry++) {
    try {
      return await attempt();
    } catch (error) {
      const delay = delays[retry];
      if (delay === undefined || !isRetryable(error) || Date.now() + delay >= deadline) throw error;
      await sleep(delay);
    }
  }
};
