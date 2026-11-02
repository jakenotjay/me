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
