import { describe, expect, it } from "vitest";
import { runReads } from "./coordinator";

describe("runReads", () => {
  it("one rejecting and one null layer still yield the others", async () => {
    const got: Record<string, unknown> = {};
    await runReads<number | null>(
      [
        { key: "a", read: () => Promise.reject(new Error("boom")) },
        { key: "b", read: async () => null },
        { key: "c", read: async () => 7 },
      ],
      { isCurrent: () => true, onResult: (k, r) => (got[k] = r), onFail: (k) => (got[k] = "failed") },
    );
    expect(got).toEqual({ a: "failed", b: null, c: 7 });
  });
  it("drops results and failures of a superseded request", async () => {
    let current = true;
    let release!: (n: number) => void;
    const late = new Promise<number>((r) => (release = r));
    const got: string[] = [];
    const p = runReads<number>(
      [
        { key: "late", read: () => late },
        { key: "bad", read: () => Promise.reject(new Error("x")) },
      ],
      { isCurrent: () => current, onResult: (k) => got.push(k), onFail: (k) => got.push(`fail:${k}`) },
    );
    current = false;
    release(1);
    await p;
    expect(got).toEqual([]);
  });
});
