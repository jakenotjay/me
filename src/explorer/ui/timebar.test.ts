import { describe, expect, it } from "vitest";
import { MAX_WAIT_MS, MIN_DWELL_MS, shouldStep } from "./timebar";

describe("shouldStep", () => {
  it("waits for the minimum dwell even when loaded", () => {
    expect(shouldStep(MIN_DWELL_MS - 1, true)).toBe(false);
    expect(shouldStep(MIN_DWELL_MS, true)).toBe(true);
  });
  it("waits for the load after the dwell", () => {
    expect(shouldStep(MIN_DWELL_MS + 3000, false)).toBe(false);
  });
  it("steps after the max wait whether or not loaded", () => {
    expect(shouldStep(MAX_WAIT_MS, false)).toBe(true);
    expect(shouldStep(MAX_WAIT_MS - 1, false)).toBe(false);
  });
});
