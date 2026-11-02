import { describe, expect, it } from "vitest";
import { argmaxClasses } from "./forty";

describe("argmaxClasses", () => {
  it("picks the max band index per pixel (2 px x 7 bands)", () => {
    const bands = Array.from({ length: 7 }, () => new Uint8Array(2));
    bands[3][0] = 100;
    bands[6][1] = 90;
    bands[1][1] = 10;
    expect(Array.from(argmaxClasses(bands, 255, false))).toEqual([3, 6]);
  });
  it("returns 255 where nodata", () => {
    const bands = Array.from({ length: 7 }, () => new Uint8Array(2));
    bands[0][0] = 255;
    bands[2][1] = 5;
    expect(Array.from(argmaxClasses(bands, 255, false))).toEqual([255, 2]);
  });
  it("any band carrying nodata marks the pixel nodata", () => {
    const bands = Array.from({ length: 3 }, () => new Uint8Array(1));
    bands[2][0] = 255;
    bands[0][0] = 20;
    expect(argmaxClasses(bands, 255, false)[0]).toBe(255);
  });
  it("implicit other = 250 - sum becomes class index bands.length", () => {
    const bands = Array.from({ length: 5 }, () => new Uint8Array([10]));
    expect(argmaxClasses(bands, 255, true)[0]).toBe(5);
  });
  it("explicit bands win over a smaller implicit other", () => {
    const bands = Array.from({ length: 5 }, () => new Uint8Array([0]));
    bands[2][0] = 200;
    expect(argmaxClasses(bands, 255, true)[0]).toBe(2);
  });
  it("ties pick the lowest index", () => {
    const bands = [new Uint8Array([50]), new Uint8Array([50]), new Uint8Array([10])];
    expect(argmaxClasses(bands, 255, false)[0]).toBe(0);
  });
});
