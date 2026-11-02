import { describe, expect, it } from "vitest";
import { layerById } from "../catalog";
import { monthFor, sourceId, yearFor } from "./layers";

const forty = layerById("forty-v2")!;
describe("sourceId", () => {
  it("differs between years for the same item", () => {
    expect(sourceId(forty, "31U/x", { year: 2017 })).not.toBe(sourceId(forty, "31U/x", { year: 2018 }));
  });
  it("is stable", () => {
    expect(sourceId(forty, "31U/x", { year: 2017 })).toBe(sourceId(forty, "31U/x", { year: 2017 }));
  });
  it("differs by layer, item and month", () => {
    const sw = layerById("surface-water")!;
    expect(sourceId(forty, "a", {})).not.toBe(sourceId(forty, "b", {}));
    expect(sourceId(sw, "a", { month: "2023-01" })).not.toBe(sourceId(sw, "a", { month: "2023-02" }));
    expect(sourceId(forty, "a", {})).not.toBe(sourceId(layerById("forty-v1")!, "a", {}));
  });
});

describe("yearFor", () => {
  it("returns undefined without years", () => expect(yearFor(layerById("forty-v1")!, 2020)).toBeUndefined());
  it("returns exact year", () => expect(yearFor(forty, 2019)).toBe(2019));
  it("snaps to nearest available", () => {
    expect(yearFor(forty, 2005)).toBe(2017);
    expect(yearFor(forty, 2100)).toBe(2025);
  });
});

describe("monthFor", () => {
  const sw = layerById("surface-water")!;
  it("keeps a valid month", () => expect(monthFor(sw, "2023-05")).toBe("2023-05"));
  it("falls back to the nearest available month", () => {
    expect(monthFor(sw, "2020-01")).toBe("2022-01");
    expect(monthFor(sw, "2030-01")).toBe("2024-12");
  });
  it("undefined without months", () => expect(monthFor(forty, "2023-05")).toBeUndefined());
});
