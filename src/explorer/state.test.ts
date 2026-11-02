import { describe, expect, it } from "vitest";
import { LAYERS, layerById } from "./catalog";
import { createStore, decodeHash, defaultState, encodeHash, timeRange, yearFor, type ExplorerState } from "./state";

const withVisible = (visible: string[]): ExplorerState => ({ ...defaultState(), visible });

describe("timeRange", () => {
  it("forty-v2 alone is 2017-2025", () => {
    expect(timeRange(withVisible(["forty-v2"]), LAYERS)).toEqual([2017, 2025]);
  });
  it("union with tmf-annual-change is 1990-2025", () => {
    expect(timeRange(withVisible(["forty-v2", "tmf-annual-change"]), LAYERS)).toEqual([1990, 2025]);
  });
  it("null when no time layer is visible", () => {
    expect(timeRange(withVisible([]), LAYERS)).toBeNull();
    expect(timeRange(withVisible(["drivers"]), LAYERS)).toBeNull();
  });
});

describe("yearFor", () => {
  it("clamps to the nearest available year", () => {
    const def = layerById("forty-v2")!;
    expect(yearFor(def, 1995)).toBe(2017);
    expect(yearFor(def, 2030)).toBe(2025);
    expect(yearFor(def, 2020)).toBe(2020);
  });
  it("is undefined without years", () => {
    expect(yearFor(layerById("forty-v1")!, 2020)).toBeUndefined();
  });
});

describe("hash", () => {
  const custom: ExplorerState = {
    visible: ["tmf-annual-change", "forty-v2"],
    opacity: { "forty-v2": 0.4 },
    year: 2003,
    month: "2023-06",
    basemap: "osm",
    inspect: true,
    view: { lon: 101.5, lat: -2.25, zoom: 7.5 },
    controlsOpen: false,
  };
  it("round-trips a non-default state", () => {
    expect(decodeHash(encodeHash(custom), LAYERS)).toEqual(custom);
  });
  it("round-trips the default state", () => {
    expect(decodeHash(encodeHash(defaultState()), LAYERS)).toEqual(defaultState());
  });
  it("garbage gives defaults", () => {
    expect(decodeHash("#garbage", LAYERS)).toEqual(defaultState());
    expect(decodeHash("", LAYERS)).toEqual(defaultState());
  });
  it("drops unknown layer ids", () => {
    expect(decodeHash("#l=nope,forty-v1,also-nope", LAYERS).visible).toEqual(["forty-v1"]);
  });
  it("bad year, month, basemap, view fall back to defaults", () => {
    const s = decodeHash("#y=1700&m=zzz&b=moon&v=1,2", LAYERS);
    const d = defaultState();
    expect([s.year, s.month, s.basemap, s.view]).toEqual([d.year, d.month, d.basemap, d.view]);
  });
});

describe("store", () => {
  it("notifies subscribers with patched state", () => {
    const store = createStore(defaultState());
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.year));
    store.set({ year: 2019 });
    expect(store.get().year).toBe(2019);
    expect(seen).toEqual([2019]);
  });
});
