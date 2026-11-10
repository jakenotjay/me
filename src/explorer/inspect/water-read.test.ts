import { afterEach, describe, expect, it, vi } from "vitest";
import { layerById } from "../catalog";
import { mapLimit } from "./coordinator";
import { isNotFound, readLayerPoint } from "./pixel";

const water = layerById("surface-water")!;
const items = [{ id: "0E_10N", bbox: [0, 10, 10, 0] as [number, number, number, number] }];

afterEach(() => vi.unstubAllGlobals());

describe("isNotFound", () => {
  it("recognises a 404 however it is carried", () => {
    expect(isNotFound({ code: 404 })).toBe(true);
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound(new Error("x", { cause: { statusCode: 404 } }))).toBe(true);
    expect(isNotFound(new Error("Failed to fetch https://x/y.tif bytes=0-1 404"))).toBe(true);
  });
  it("treats 5xx, 403 and network errors as failures", () => {
    expect(isNotFound({ code: 503 })).toBe(false);
    expect(isNotFound({ code: 403 })).toBe(false);
    expect(isNotFound(new TypeError("Failed to fetch"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});

describe("readLayerPoint on a water month", () => {
  it("404 is no observation (null)", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readLayerPoint(water, items, { month: "2018-03" }, 5, 5)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalled();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("range")).toBe("bytes=0-16383");
  });
  it("503 is an error, not no observation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    await expect(readLayerPoint(water, items, { month: "2018-04" }, 5, 5)).rejects.toBeDefined();
  });
  it("a network error is an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(readLayerPoint(water, items, { month: "2018-05" }, 5, 5)).rejects.toBeDefined();
  });
  it("an aborted signal starts no open and no request", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctl = new AbortController();
    ctl.abort();
    await expect(readLayerPoint(water, items, { month: "2018-06" }, 5, 5, ctl.signal)).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("mapLimit", () => {
  it("never exceeds the limit and returns results in order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
  it("starts no further work once the signal aborts", async () => {
    const ctl = new AbortController();
    const started: number[] = [];
    const p = mapLimit(
      Array.from({ length: 50 }, (_, i) => i),
      4,
      async (n) => {
        started.push(n);
        if (n === 3) ctl.abort();
        await new Promise((r) => setTimeout(r, 2));
      },
      ctl.signal,
    );
    await expect(p).rejects.toBeDefined();
    expect(started.length).toBeLessThan(12);
  });
});
