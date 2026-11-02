/**
 * Bounded retry for source.coop range requests. The geotiff library fetches headers and tiles
 * through the global `fetch` (chunkd's SourceHttp), so a scoped wrapper covers both paths; a
 * 503/429 or network error would otherwise leave a tile bare for good.
 */
export const RETRY_ATTEMPTS = 3;
export const RETRY_BASE_MS = 300;
export const RETRYABLE_STATUS = new Set([429, 503]);

export const retryStats = { retries: 0, failures: 0 };
const warned = new Set<string>();

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const urlOf = (input: RequestInfo | URL) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Warn about a failed URL once. */
export function logFailureOnce(what: string, err: unknown) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`explorer: ${what} failed`, err);
}

export async function fetchWithRetry(
  base: FetchFn,
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: { attempts?: number; baseMs?: number; random?: () => number } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? RETRY_ATTEMPTS;
  const baseMs = opts.baseMs ?? RETRY_BASE_MS;
  const random = opts.random ?? Math.random;
  for (let i = 1; ; i++) {
    let res: Response | undefined;
    let err: unknown;
    try {
      res = await base(input, init);
      if (!RETRYABLE_STATUS.has(res.status)) return res;
    } catch (e) {
      if (init?.signal?.aborted) throw e;
      err = e;
    }
    if (i >= attempts) {
      retryStats.failures++;
      logFailureOnce(urlOf(input), err ?? `HTTP ${res?.status}`);
      if (res) return res;
      throw err;
    }
    retryStats.retries++;
    // Jittered exponential backoff: 0.5x-1.5x of base * 2^(i-1).
    await sleep(baseMs * 2 ** (i - 1) * (0.5 + random()), init?.signal);
  }
}

/** Wrap global fetch for `data.source.coop` only. Idempotent. */
export function installRetryingFetch(host = "data.source.coop") {
  const g = globalThis as { fetch: FetchFn & { __retrying?: boolean } };
  if (g.fetch.__retrying) return;
  const orig = g.fetch.bind(globalThis);
  const wrapped: FetchFn & { __retrying?: boolean } = (input, init) =>
    urlOf(input).includes(`//${host}/`) ? fetchWithRetry(orig, input, init) : orig(input, init);
  wrapped.__retrying = true;
  g.fetch = wrapped;
}
