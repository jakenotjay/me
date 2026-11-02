import { describe, expect, it } from "vitest";
import { pixelFor } from "./pixel";

describe("pixelFor", () => {
  it("north-up transform", () => {
    expect(pixelFor([500000, 10, 0, 6000000, 0, -10], 100, 100, 500015, 5999985)).toEqual({ col: 1, row: 1 });
  });
  it("bottom-up transform (positive e)", () => {
    expect(pixelFor([500000, 10, 0, 5955200, 0, 10], 4512, 4512, 500015, 5955215)).toEqual({ col: 1, row: 1 });
  });
  it("returns null outside", () => {
    const t: [number, number, number, number, number, number] = [500000, 10, 0, 6000000, 0, -10];
    expect(pixelFor(t, 100, 100, 499999, 5999985)).toBeNull();
    expect(pixelFor(t, 100, 100, 500015, 6000001)).toBeNull();
    expect(pixelFor(t, 100, 100, 501000, 5999985)).toBeNull();
    expect(pixelFor(t, 100, 100, 500015, 5999000)).toBeNull();
  });
});
