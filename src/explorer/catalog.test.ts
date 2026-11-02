import { describe, it, expect } from "vitest";
import { LAYERS, layerById } from "./catalog";

const IDS = ["forty-v2","forty-v1","tmf-annual-change","tmf-deforestation-year","tmf-degradation-year","tmf-transition-main","tmf-transition-subtypes","tmf-undisturbed-degraded","drivers","natural-planted","gfc-2020","gft-2020","surface-water"];
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("catalog", () => {
  it("has all 13 unique ids", () => {
    expect(LAYERS.map((l) => l.id).sort()).toEqual([...IDS].sort());
    expect(new Set(LAYERS.map((l) => l.id)).size).toBe(13);
  });
  it("has descriptions and legends", () => {
    for (const l of LAYERS) {
      expect(l.description.length).toBeGreaterThan(0);
      expect(l.legend).toBeTruthy();
      expect(l.sourceUrl).toMatch(/^https:\/\//);
    }
  });
  it("class and ramp colours are valid hex", () => {
    for (const l of LAYERS) {
      const cols = l.legend.kind === "classes" ? l.legend.classes.map((c) => c.color) : l.legend.colors;
      expect(cols.length).toBeGreaterThan(0);
      for (const c of cols) expect(c).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
  it("years", () => {
    expect(layerById("forty-v2")!.years).toEqual(range(2017, 2025));
    expect(layerById("tmf-annual-change")!.years).toEqual(range(1990, 2025));
  });
  it("urls", () => {
    expect(layerById("forty-v2")!.url({ id: "31U/raster_31U_20_0_0", year: 2025 })).toBe("https://data.source.coop/epoch/forest-typology-2020/v2_beta/2025/31U/raster_31U_20_0_0.tif");
    expect(layerById("forty-v1")!.url({ id: "31U/raster_31U_20_0_0" })).toBe("https://data.source.coop/epoch/forest-typology-2020/v1/31U/raster_31U_20_0_0.tif");
    expect(layerById("tmf-annual-change")!.url({ id: "S20_W70", year: 1990 })).toBe("https://data.source.coop/epoch/jrc-tmf/v1_2025/S20_W70/AnnualChange_1990.tif");
    expect(layerById("surface-water")!.url({ id: "0E_10N", month: "2024-01" })).toBe("https://data.source.coop/epoch/jrc-global-surface-water-monthly/v1_5/2024/2024_01/monthlyhistory_0E_10N_v1_5_2024_01.tif");
  });
  it("forty-v2 legend", () => {
    const lg = layerById("forty-v2")!.legend;
    if (lg.kind !== "classes") throw new Error("kind");
    expect(lg.classes).toHaveLength(7);
    expect(new Set(lg.classes.map((c) => c.color.toLowerCase())).size).toBe(7);
    expect(lg.classes.map((c) => c.label)).toContain("Primary forest (regrowing)");
  });
  it("tmf subtypes has 39 classes", () => {
    const lg = layerById("tmf-transition-subtypes")!.legend;
    if (lg.kind !== "classes") throw new Error("kind");
    expect(lg.classes).toHaveLength(39);
  });
  it("gft render mode", () => {
    expect(layerById("gft-2020")!.render).toBe("presence-below-z14");
  });
  it("url builders throw on missing args", () => {
    expect(() => layerById("forty-v2")!.url({ id: "31U/x" })).toThrow();
    expect(() => layerById("forty-v2")!.url({ year: 2020 })).toThrow();
    expect(() => layerById("forty-v1")!.url({})).toThrow();
    expect(() => layerById("tmf-annual-change")!.url({ id: "S20_W70" })).toThrow();
    expect(() => layerById("tmf-annual-change")!.url({ year: 1990 })).toThrow();
    expect(() => layerById("tmf-transition-main")!.url({})).toThrow();
    expect(() => layerById("natural-planted")!.url({})).toThrow();
    expect(() => layerById("surface-water")!.url({ id: "0E_10N" })).toThrow();
    expect(() => layerById("surface-water")!.url({ id: "0E_10N", month: "2024-1" })).toThrow();
    expect(() => layerById("surface-water")!.url({ month: "2024-01" })).toThrow();
  });
  it("pins real class values", () => {
    const classes = (id: string) => {
      const lg = layerById(id)!.legend;
      if (lg.kind !== "classes") throw new Error("kind");
      return new Map(lg.classes.map((c) => [c.value, c.color.toUpperCase()]));
    };
    const sub = classes("tmf-transition-subtypes");
    expect(sub.get(10)).toBe("#005000");
    expect(sub.get(53)).toBe("#8C641E");
    expect(sub.get(94)).toBe("#D6FABC");
    const main = classes("tmf-transition-main");
    expect(main.get(10)).toBe("#005000");
    expect(main.get(41)).toBe("#FFC894");
    expect(main.get(60)).toBe("#0046A0");
    expect(main.get(70)).toBe("#FFFFFF");
    const annual = classes("tmf-annual-change");
    expect(annual.get(1)).toBe("#005A00");
    expect(annual.get(3)).toBe("#FF870F");
    expect(annual.get(5)).toBe("#008CBE");
    const v2 = classes("forty-v2");
    expect(v2.get(0)).toBe("#1B7837");
    expect(v2.get(6)).toBe("#35978F");
  });
  it("surface-water months and drivers config", () => {
    const m = layerById("surface-water")!.months!;
    expect(m).toHaveLength(36);
    expect(m[0]).toBe("2022-01");
    expect(m[35]).toBe("2024-12");
    const d = layerById("drivers")!;
    expect(d.band).toBe(0);
    expect(d.nodata).toEqual([255, 0]);
  });
  it("index fields", () => {
    expect(layerById("forty-v1")!.index).toBe("forty");
    expect(layerById("tmf-transition-main")!.index).toBe("tmf");
    expect(layerById("drivers")!.index).toBeUndefined();
  });
});
