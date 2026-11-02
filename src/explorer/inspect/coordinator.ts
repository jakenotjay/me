/** One read per layer, run independently: one failing or empty layer never blocks the others. */
export type ReadJob<R> = { key: string; read: () => Promise<R> };

/**
 * Start every job. `isCurrent` says whether the request that started them is still the active one;
 * results (and failures) of a superseded request are dropped. A failure is reported through
 * `onFail` for that key only.
 */
export function runReads<R>(
  jobs: ReadJob<R>[],
  opts: {
    isCurrent: () => boolean;
    onResult: (key: string, result: R) => void;
    onFail: (key: string, err: unknown) => void;
  },
): Promise<void> {
  return Promise.all(
    jobs.map((j) =>
      j.read().then(
        (r) => {
          if (opts.isCurrent()) opts.onResult(j.key, r);
        },
        (err) => {
          if (opts.isCurrent()) opts.onFail(j.key, err);
        },
      ),
    ),
  ).then(() => undefined);
}

/**
 * Map `items` with at most `limit` calls in flight. `signal` is checked before each call starts, so once it is
 * aborted no further work begins (and nothing more reaches the shared request limiter).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      signal?.throwIfAborted();
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
