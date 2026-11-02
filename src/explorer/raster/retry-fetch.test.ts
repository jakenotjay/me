import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry, retryStats } from "./retry-fetch";

const res = (status: number) => new Response(null, { status });
const fast = { baseMs: 0, random: () => 0.5 };

describe("fetchWithRetry", () => {
  it("returns the first non-retryable response without retrying", async () => {
    const f = vi.fn().mockResolvedValue(res(200));
    expect((await fetchWithRetry(f, "https://x/a", undefined, fast)).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("retries 503 and 429 then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(429)).mockResolvedValue(res(206));
    expect((await fetchWithRetry(f, "https://x/b", undefined, fast)).status).toBe(206);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("retries network errors, and gives up after 3 attempts", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("net"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = retryStats.failures;
    await expect(fetchWithRetry(f, "https://x/c", undefined, fast)).rejects.toThrow("net");
    expect(f).toHaveBeenCalledTimes(3);
    expect(retryStats.failures).toBe(before + 1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it("returns the final 503 after 3 attempts and does not retry 404", async () => {
    const f = vi.fn().mockResolvedValue(res(503));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await fetchWithRetry(f, "https://x/d", undefined, fast)).status).toBe(503);
    expect(f).toHaveBeenCalledTimes(3);
    const g = vi.fn().mockResolvedValue(res(404));
    expect((await fetchWithRetry(g, "https://x/e", undefined, fast)).status).toBe(404);
    expect(g).toHaveBeenCalledTimes(1);
  });
  it("does not retry an aborted request", async () => {
    const ac = new AbortController();
    ac.abort();
    const f = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(fetchWithRetry(f, "https://x/f", { signal: ac.signal }, fast)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
