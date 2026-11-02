import { describe, expect, it } from "vitest";
import { buildLut, hexToRgb, presenceLut, rescaleToIndex, toClassIndices } from "./colormap";

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

describe("hexToRgb", () => {
  it("parses with and without #", () => {
    expect(hexToRgb("#FF870F")).toEqual([255, 135, 15]);
    expect(hexToRgb("1b7837")).toEqual([27, 120, 55]);
  });
  it.each(["", "#fff", "#GG0000", "#12345", "#1234567", "red"])("rejects %j", (bad) => {
    expect(() => hexToRgb(bad)).toThrow(/Bad colour/);
  });
});

describe("buildLut classes", () => {
  it("skips out-of-range class values", () => {
    const lut = buildLut({
      kind: "classes",
      classes: [
        { value: -1, label: "neg", color: "#FF0000" },
        { value: 256, label: "big", color: "#00FF00" },
        { value: 255, label: "edge", color: "#0000FF" },
      ],
    });
    expect(lut.length).toBe(1024);
    expect(Array.from(lut.slice(1020, 1024))).toEqual([0, 0, 255, 255]);
    expect(lut.slice(0, 1020).every((v) => v === 0)).toBe(true);
  });

  it("makes nodata values transparent even when listed as classes", () => {
    const l = buildLut(
      {
        kind: "classes",
        classes: [
          { value: 255, label: "x", color: "#0000FF" },
          { value: 1, label: "y", color: "#FF0000" },
        ],
      },
      [255],
    );
    expect(l[1023]).toBe(0);
    expect(l[7]).toBe(255);
  });
});

describe("buildLut ramp", () => {
  const ramp = (colors: string[]) => buildLut({ kind: "ramp", colors, min: 0, max: 1, minLabel: "", maxLabel: "" });
  const px = (l: Uint8Array, i: number) => Array.from(l.slice(i * 4, i * 4 + 4));

  it("reserves index 0 as transparent", () => {
    expect(ramp(["#000000", "#FFFFFF"])[3]).toBe(0);
  });
  it("interpolates 2 stops over 1..255", () => {
    const l = ramp(["#000000", "#FFFFFF"]);
    expect(px(l, 1)).toEqual([0, 0, 0, 255]);
    expect(px(l, 255)).toEqual([255, 255, 255, 255]);
    expect(px(l, 128)[0]).toBeGreaterThan(125);
    expect(px(l, 128)[0]).toBeLessThan(130);
  });
  it("handles 1 stop", () => {
    const l = ramp(["#336699"]);
    expect(px(l, 1)).toEqual([0x33, 0x66, 0x99, 255]);
    expect(px(l, 255)).toEqual([0x33, 0x66, 0x99, 255]);
  });
  it("hits the middle stop of 3", () => {
    const l = ramp(["#FF0000", "#00FF00", "#0000FF"]);
    expect(px(l, 128)).toEqual([0, 255, 0, 255]);
  });
  it("zeroes nodata alpha", () => {
    const l = buildLut({ kind: "ramp", colors: ["#000000", "#FFFFFF"], min: 0, max: 1, minLabel: "", maxLabel: "" }, [7]);
    expect(l[7 * 4 + 3]).toBe(0);
  });
});

describe("rescaleToIndex (uint16 years)", () => {
  it("maps nodata to 0 and min..max to 1..255", () => {
    const out = rescaleToIndex(new Uint16Array([0, 1984, 2025, 2004, 1900, 3000]), 1984, 2025, [0]);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out.slice(0, 3))).toEqual([0, 1, 255]);
    expect(out[3]).toBeGreaterThan(100);
    expect(out[3]).toBeLessThan(150);
    expect(out[4]).toBe(1);
    expect(out[5]).toBe(255);
  });
});

describe("toClassIndices", () => {
  it("passes uint8 through unchanged", () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(toClassIndices(a)).toBe(a);
  });
  it("sends out-of-range values from wider types to 255", () => {
    expect(Array.from(toClassIndices(new Uint16Array([1, 255, 256, 60000])))).toEqual([1, 255, 255, 255]);
    expect(Array.from(toClassIndices(new Int16Array([-1, 5])))).toEqual([255, 5]);
  });
});

describe("presenceLut", () => {
  it("colours every non-zero value with one colour", () => {
    const l = presenceLut("#4D9221");
    expect(l[3]).toBe(0);
    expect(Array.from(l.slice(40, 44))).toEqual([0x4d, 0x92, 0x21, 255]);
    expect(Array.from(l.slice(1020, 1024))).toEqual([0x4d, 0x92, 0x21, 255]);
  });
});
