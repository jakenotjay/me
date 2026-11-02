import { describe, expect, it } from "vitest";
import { readBands } from "./bands";

describe("readBands", () => {
  it("returns band-separate bands as-is", () => {
    const bands = [new Uint16Array([1, 2]), new Uint16Array([3, 4])];
    const out = readBands({ layout: "band-separate", bands, count: 2 } as never);
    expect(out[0]).toBe(bands[0]);
  });
  it("de-interleaves preserving the typed array type", () => {
    const data = new Uint16Array([1984, 7, 2025, 8]);
    const out = readBands({ layout: "pixel-interleaved", data, count: 2 } as never);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(Uint16Array);
    expect(Array.from(out[0])).toEqual([1984, 2025]);
    expect(Array.from(out[1])).toEqual([7, 8]);
  });
  it("preserves float arrays", () => {
    const out = readBands({ layout: "pixel-interleaved", data: new Float32Array([0.5, 1.5]), count: 1 } as never);
    expect(out[0]).toBeInstanceOf(Float32Array);
  });
});
