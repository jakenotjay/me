import { describe, expect, it } from "vitest";
import { layerById } from "../catalog";
import { decodeValue } from "./decode";

const L = (id: string) => layerById(id)!;

describe("decodeValue", () => {
  it("null is no data", () => {
    expect(decodeValue(L("forty-v2"), null)).toEqual({ label: "no data" });
  });
  it("forty-v2 argmax with percentages", () => {
    const d = decodeValue(L("forty-v2"), [200, 10, 0, 0, 0, 40, 0]);
    expect(d.label).toBe("Primary");
    expect(d.color).toBe("#1B7837");
    expect(d.detail).toContain("80%");
    expect(d.detail).toContain("Other land 16%");
  });
  it("forty-v2 nodata", () => {
    expect(decodeValue(L("forty-v2"), [255, 255, 255, 255, 255, 255, 255]).label).toBe("no data");
  });
  it("forty-v1 implicit other land", () => {
    expect(decodeValue(L("forty-v1"), [10, 0, 0, 0, 0]).label).toBe("Other land");
  });
  it("year layers", () => {
    expect(decodeValue(L("tmf-deforestation-year"), [2014]).label).toBe("Deforested in 2014");
    expect(decodeValue(L("tmf-deforestation-year"), [0]).label).toBe("Never");
    expect(decodeValue(L("tmf-degradation-year"), [2003]).label).toBe("Degraded in 2003");
  });
  it("class layers use the legend", () => {
    const d = decodeValue(L("tmf-annual-change"), [3]);
    expect(d.label).toBe("Deforested land");
    expect(d.color).toBe("#FF870F");
    expect(decodeValue(L("tmf-annual-change"), [0]).label).toBe("no data");
    expect(decodeValue(L("tmf-annual-change"), [99]).label).toBe("no data");
  });
  it("drivers class plus probabilities", () => {
    const d = decodeValue(L("drivers"), [1, 200, 0, 0, 0, 0, 0, 25]);
    expect(d.label).toBe("Permanent agriculture");
    expect(d.detail).toContain("80%");
    expect(d.detail).toContain("Other natural disturbances 10%");
    expect(decodeValue(L("drivers"), [255, 0, 0, 0, 0, 0, 0, 0]).label).toBe("no data");
  });
});
