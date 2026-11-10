import { describe, expect, it } from "vitest";
import { PerOriginSemaphore } from "@developmentseed/geotiff";
import { createSourceLimiter } from "./limiter";

const url = new URL("https://data.source.coop/test.tif");

describe("source request priorities", () => {
  it("serves foreground requests before an earlier background request regardless of distance", async () => {
    const shared = new PerOriginSemaphore({ maxRequests: 1 });
    const release = await shared.acquire(url);
    const foreground = createSourceLimiter(() => false, shared);
    const background = createSourceLimiter(() => true, shared);
    const order: string[] = [];
    const pendingBackground = background.acquire(url, undefined, () => 0).then((done) => { order.push("background"); done(); });
    const pendingForeground = foreground.acquire(url, undefined, () => 999).then((done) => { order.push("foreground"); done(); });
    release();
    await Promise.all([pendingBackground, pendingForeground]);
    expect(order).toEqual(["foreground", "background"]);
  });

  it("promotes an already queued frame to foreground when its role changes", async () => {
    const shared = new PerOriginSemaphore({ maxRequests: 1 });
    const release = await shared.acquire(url);
    let isBackground = true;
    const candidate = createSourceLimiter(() => isBackground, shared);
    const foreground = createSourceLimiter(() => false, shared);
    const order: string[] = [];
    const pendingCandidate = candidate.acquire(url, undefined, () => 0).then((done) => { order.push("promoted"); done(); });
    const pendingForeground = foreground.acquire(url, undefined, () => 10).then((done) => { order.push("other"); done(); });
    isBackground = false;
    release();
    await Promise.all([pendingCandidate, pendingForeground]);
    expect(order).toEqual(["promoted", "other"]);
  });

  it("cancels queued background work without blocking the next foreground request", async () => {
    const shared = new PerOriginSemaphore({ maxRequests: 1 });
    const release = await shared.acquire(url);
    const background = createSourceLimiter(() => true, shared);
    const foreground = createSourceLimiter(() => false, shared);
    const ctl = new AbortController();
    const pending = background.acquire(url, ctl.signal);
    const canceled = expect(pending).rejects.toBeDefined();
    ctl.abort();
    await canceled;
    const next = foreground.acquire(url);
    release();
    const done = await next;
    done();
  });
});
