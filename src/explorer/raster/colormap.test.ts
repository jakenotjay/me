import { describe, expect, it } from "vitest";
import { buildLut } from "./colormap";

describe("buildLut", () => {
  const lut = buildLut({ kind: "classes", classes: [{ value: 3, label: "x", color: "#FF870F" }] });

  it("is 256 RGBA entries", () => {
    expect(lut).toBeInstanceOf(Uint8Array);
    expect(lut.length).toBe(1024);
  });

  it("writes the class colour opaque at its value", () => {
    expect(Array.from(lut.slice(12, 16))).toEqual([255, 135, 15, 255]);
  });

  it("leaves unlisted values transparent", () => {
    expect(lut[3]).toBe(0);
    expect(lut[4 * 4 + 3]).toBe(0);
  });
});
