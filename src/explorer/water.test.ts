import { describe, expect, it } from "vitest";
import { LAYERS, layerById, monthsOf, surfaceWaterInspectUrl, surfaceWaterOffsets } from "./catalog";
import { decodeValue } from "./inspect/decode";
import { activeYear, clampMonth, decodeHash, defaultState, encodeHash, monthAt, monthIndex, monthLayerRange, timeAxis, toggleLayer, type ExplorerState } from "./state";
import { waterLabel } from "./ui/chart";
import { showingMonthNote } from "./ui/legend";
import { nextTime, timeLabel } from "./ui/timebar";

const SW = "https://data.source.coop/epoch/jrc-global-surface-water-monthly";
const water = layerById("surface-water")!;
const st = (visible: string[], over: Partial<ExplorerState> = {}): ExplorerState => ({ ...defaultState(), visible, ...over });

describe("surface-water inspect urls", () => {
  it("offsets for 0E_10N", () => {
    expect(surfaceWaterOffsets("0E_10N")).toEqual({ y: "0000280000", x: "0000720000" });
  });
  it("offsets for W / S zones (10W_10S)", () => {
    // y = (80 - -10) * 4000, x = (-10 + 180) * 4000
    expect(surfaceWaterOffsets("10W_10S")).toEqual({ y: "0000360000", x: "0000680000" });
    expect(surfaceWaterOffsets("170W_80N")).toEqual({ y: "0000000000", x: "0000040000" });
  });
  it("2017-2020 tiles carry the year_month prefix", () => {
    expect(surfaceWaterInspectUrl("0E_10N", "2017-01")).toBe(`${SW}/tiles/2017/2017_01/2017_01-0000280000-0000720000.tif`);
    expect(surfaceWaterInspectUrl("10W_10S", "2020-12")).toBe(`${SW}/tiles/2020/2020_12/2020_12-0000360000-0000680000.tif`);
  });
  it("2021 tiles have no prefix", () => {
    expect(surfaceWaterInspectUrl("0E_10N", "2021-07")).toBe(`${SW}/tiles/2021/2021_07/0000280000-0000720000.tif`);
  });
  it("2022+ uses the v1_5 COGs (same as the map url)", () => {
    expect(surfaceWaterInspectUrl("10W_10S", "2022-01")).toBe(`${SW}/v1_5/2022/2022_01/monthlyhistory_10W_10S_v1_5_2022_01.tif`);
    expect(surfaceWaterInspectUrl("0E_10N", "2024-12")).toBe(water.url({ id: "0E_10N", month: "2024-12" }));
  });
  it("rejects bad ids and months", () => {
    expect(() => surfaceWaterOffsets("nope")).toThrow();
    expect(() => surfaceWaterInspectUrl("0E_10N", "2020-13")).toThrow();
    expect(() => surfaceWaterInspectUrl(undefined, "2020-01")).toThrow();
    expect(() => surfaceWaterInspectUrl("0E_10N", undefined)).toThrow();
  });
  it("layer config: map months stay 2022-2024, inspect reaches 2017 (96 months)", () => {
    expect(water.months).toHaveLength(36);
    expect(water.inspectMonths).toHaveLength(96);
    expect(water.inspectMonths![0]).toBe("2017-01");
    expect(water.inspectMonths![95]).toBe("2024-12");
    expect(water.inspectUrl!({ id: "0E_10N", month: "2018-05" })).toContain("/tiles/2018/2018_05/");
  });
});

describe("month helpers", () => {
  it("monthsOf, monthIndex, monthAt round-trip", () => {
    expect(monthsOf(2017, 2018)).toHaveLength(24);
    expect(monthAt(monthIndex("2019-11") + 2)).toBe("2020-01");
    expect(monthAt(monthIndex("2017-01"))).toBe("2017-01");
  });
  it("clampMonth", () => {
    expect(clampMonth("2016-05", ["2017-01", "2018-12"])).toBe("2017-01");
    expect(clampMonth("2030-05", ["2017-01", "2018-12"])).toBe("2018-12");
    expect(clampMonth("2018-02", ["2017-01", "2018-12"])).toBe("2018-02");
  });
});

describe("timeAxis", () => {
  it("is years without a monthly layer and null without any time layer", () => {
    expect(timeAxis(st(["forty-v2"]), LAYERS)).toEqual({ unit: "year", range: [2017, 2025] });
    expect(timeAxis(st(["drivers"]), LAYERS)).toBeNull();
  });
  it("is months over the water range alone", () => {
    expect(timeAxis(st(["surface-water"]), LAYERS)).toEqual({ unit: "month", range: ["2022-01", "2024-12"] });
  });
  it("is months over the union with yearly layers", () => {
    expect(timeAxis(st(["forty-v2", "surface-water"]), LAYERS)).toEqual({ unit: "month", range: ["2017-01", "2025-12"] });
  });
  it("activeYear follows the month while water is visible", () => {
    expect(activeYear(st(["forty-v2", "surface-water"], { month: "2019-06", year: 2025 }), LAYERS)).toBe(2019);
    expect(activeYear(st(["forty-v2"], { month: "2019-06", year: 2025 }), LAYERS)).toBe(2025);
    // clamped into the axis, like the slider
    expect(activeYear(st(["surface-water"], { month: "2019-06" }), LAYERS)).toBe(2022);
  });
});

describe("time bar in month mode", () => {
  const axis = timeAxis(st(["surface-water"]), LAYERS)!;
  it("labels YYYY-MM and positions the slider by month offset", () => {
    expect(timeLabel(st(["surface-water"], { month: "2023-03" }), axis)).toEqual({ value: 14, min: 0, max: 35, label: "2023-03" });
  });
  it("clamps the label into the range", () => {
    expect(timeLabel(st(["surface-water"], { month: "2017-01" }), axis).label).toBe("2022-01");
  });
  it("keeps the year label in year mode", () => {
    const y = timeAxis(st(["forty-v2"]), LAYERS)!;
    expect(timeLabel(st(["forty-v2"], { year: 2020 }), y)).toEqual({ value: 2020, min: 2017, max: 2025, label: "2020" });
  });
  it("steps month by month, crossing the year, and sets the matching year", () => {
    expect(nextTime(st([], { month: "2022-11" }), axis)).toEqual({ month: "2022-12", year: 2022 });
    expect(nextTime(st([], { month: "2022-12" }), axis)).toEqual({ month: "2023-01", year: 2023 });
  });
  it("wraps from the end and from outside the range to the first month", () => {
    expect(nextTime(st([], { month: "2024-12" }), axis)).toEqual({ month: "2022-01", year: 2022 });
    expect(nextTime(st([], { month: "2017-05" }), axis)).toEqual({ month: "2022-01", year: 2022 });
  });
  it("still steps years in year mode", () => {
    const y = timeAxis(st(["forty-v2"]), LAYERS)!;
    expect(nextTime(st([], { year: 2019 }), y)).toEqual({ year: 2020 });
    expect(nextTime(st([], { year: 2025 }), y)).toEqual({ year: 2017 });
  });
});

describe("showingMonthNote", () => {
  it("names the nearest available month outside 2022-01..2024-12", () => {
    expect(showingMonthNote(water, "2019-06")).toBe("showing 2022-01");
    expect(showingMonthNote(water, "2025-03")).toBe("showing 2024-12");
  });
  it("is silent inside the range and for layers without months", () => {
    expect(showingMonthNote(water, "2023-06")).toBeUndefined();
    expect(showingMonthNote(layerById("forty-v2")!, "2019-06")).toBeUndefined();
  });
});

describe("hash compatibility", () => {
  it("old hashes with a map month still decode", () => {
    expect(decodeHash("#l=surface-water&m=2023-05", LAYERS).month).toBe("2023-05");
  });
  it("a pre-2022 month (reachable on the union axis) round-trips", () => {
    const s = st(["forty-v2", "surface-water"], { month: "2018-07" });
    expect(decodeHash(encodeHash(s), LAYERS).month).toBe("2018-07");
  });
  it("garbage months fall back to the default", () => {
    expect(decodeHash("#m=2023-13", LAYERS).month).toBe(defaultState().month);
    expect(decodeHash("#m=abc", LAYERS).month).toBe(defaultState().month);
  });
});

describe("decode of monthly water values", () => {
  it("0 is no data (no observation), 1 not water, 2 water, null no data", () => {
    expect(decodeValue(water, [0]).label).toBe("no data");
    expect(decodeValue(water, [1])).toEqual({ label: "Not water", color: "#FFFCB8" });
    expect(decodeValue(water, [2])).toEqual({ label: "Water", color: "#0905FF" });
    expect(decodeValue(water, null)).toEqual({ label: "no data" });
  });
  it("tooltip wording", () => {
    expect(waterLabel(2)).toBe("water");
    expect(waterLabel(1)).toBe("not water");
    expect(waterLabel(0)).toBe("no observation");
    expect(waterLabel(null)).toBe("no observation");
  });
});

describe("toggling water on", () => {
  it("seeds the month from the year when a yearly layer is visible", () => {
    const s = st(["forty-v2"], { year: 2019, month: "2024-12" });
    expect(toggleLayer(s, "surface-water", true)).toEqual({ visible: ["forty-v2", "surface-water"], month: "2019-01" });
  });
  it("leaves the month alone for water alone, when turning off, or for other layers", () => {
    expect(toggleLayer(st([], { year: 2019 }), "surface-water", true)).toEqual({ visible: ["surface-water"] });
    expect(toggleLayer(st(["forty-v2", "surface-water"]), "surface-water", false)).toEqual({ visible: ["forty-v2"] });
    expect(toggleLayer(st(["forty-v2"]), "drivers", true)).toEqual({ visible: ["forty-v2", "drivers"] });
  });
  it("the seeded month keeps the yearly layer on the same year", () => {
    const s = st(["forty-v2"], { year: 2019 });
    const next = { ...s, ...toggleLayer(s, "surface-water", true) } as ExplorerState;
    expect(activeYear(next, LAYERS)).toBe(2019);
  });
});

describe("union-mode play", () => {
  const s0 = st(["forty-v2", "surface-water"]);
  const axis = timeAxis(s0, LAYERS)!; // 2017-01..2025-12
  const range = monthLayerRange(s0, LAYERS);
  it("map range of the visible month layers", () => expect(range).toEqual(["2022-01", "2024-12"]));
  it("steps a year at a time before the water range, landing on its start", () => {
    expect(nextTime(st([], { month: "2017-03" }), axis, range)).toEqual({ month: "2018-03", year: 2018 });
    expect(nextTime(st([], { month: "2021-05" }), axis, range)).toEqual({ month: "2022-01", year: 2022 });
  });
  it("steps a month at a time inside the range", () => {
    expect(nextTime(st([], { month: "2022-01" }), axis, range)).toEqual({ month: "2022-02", year: 2022 });
    expect(nextTime(st([], { month: "2024-11" }), axis, range)).toEqual({ month: "2024-12", year: 2024 });
  });
  it("steps a year at a time after the range, then wraps", () => {
    expect(nextTime(st([], { month: "2024-12" }), axis, range)).toEqual({ month: "2025-01", year: 2025 });
    expect(nextTime(st([], { month: "2025-01" }), axis, range)).toEqual({ month: "2017-01", year: 2017 });
  });
});
