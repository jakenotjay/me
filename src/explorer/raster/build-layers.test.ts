import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexItem } from "../types";
import type { ExplorerState } from "../state";
import { buildDeckLayers, onLayersChanged } from "./layers";

const base: ExplorerState = {
  visible: [],
  opacity: {},
  year: 2020,
  month: "2023-06",
  basemap: "satellite",
  inspect: false,
  view: { lon: 0, lat: 0, zoom: 5 },
  controlsOpen: false,
};
const tmfItems: IndexItem[] = [{ id: "S10_W70", bbox: [-70, -10, -60, 0] }];
const idx = { tmf: tmfItems };
const st = (over: Partial<ExplorerState>): ExplorerState => ({ ...base, ...over });
const ids = (ls: { id: string }[]) => ls.map((l) => l.id);
// Simulate the mosaic reporting an (empty) viewport so the generation counts as loaded.
const markLoaded = (l: unknown) =>
  (l as { props: { onViewportLoad: (e: unknown[]) => void } }).props.onViewportLoad([]);

afterEach(() => {
  buildDeckLayers(st({ visible: [] }), idx, 5); // clears tracking
  onLayersChanged(null);
});

describe("buildDeckLayers", () => {
  it("renders nothing below minZoom or for hidden layers", () => {
    expect(buildDeckLayers(st({ visible: ["forty-v2"] }), { forty: [{ id: "a", bbox: [0, 0, 1, 1] }] }, 7)).toHaveLength(0);
    expect(buildDeckLayers(st({ visible: [] }), idx, 5)).toHaveLength(0);
  });

  it("waits for the index before rendering index-backed layers", () => {
    expect(buildDeckLayers(st({ visible: ["tmf-annual-change"] }), {}, 5)).toHaveLength(0);
  });

  it("builds a single COG layer for non-index layers at any zoom", () => {
    const ls = buildDeckLayers(st({ visible: ["drivers"] }), {}, 2);
    expect(ls).toHaveLength(1);
    expect(ls[0].id).toMatch(/^cog:drivers/);
  });

  it("uses year-keyed ids so a year change makes a new layer", () => {
    const a = buildDeckLayers(st({ visible: ["tmf-annual-change"], year: 2019 }), idx, 5);
    const b = buildDeckLayers(st({ visible: ["tmf-annual-change"], year: 2020 }), idx, 5);
    expect(a[0].id).not.toBe(b[0].id);
  });

  it("keeps one previous year underneath until the new one loads", () => {
    const changed = vi.fn();
    onLayersChanged(changed);
    const s = (year: number) => st({ visible: ["tmf-annual-change"], year });

    const y1 = buildDeckLayers(s(2019), idx, 5);
    markLoaded(y1[0]);

    const y2 = buildDeckLayers(s(2020), idx, 5);
    expect(ids(y2)).toEqual([y1[0].id, expect.stringContaining("2020")]);

    // Re-render with the same state keeps the same pair (stable ids).
    expect(ids(buildDeckLayers(s(2020), idx, 5))).toEqual(ids(y2));

    // Scrub on before 2020 finished: previous stays 2019 (the one with content), 2020 is dropped.
    const y3 = buildDeckLayers(s(2021), idx, 5);
    expect(ids(y3)).toEqual([y1[0].id, expect.stringContaining("2021")]);

    markLoaded(y3[1]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(ids(buildDeckLayers(s(2021), idx, 5))).toEqual([y3[1].id]);
  });

  it("switches GFT between presence and classes at zoom 14 via the layer id", () => {
    const lo = buildDeckLayers(st({ visible: ["gft-2020"] }), {}, 8);
    const hi = buildDeckLayers(st({ visible: ["gft-2020"] }), {}, 14);
    expect(lo[0].id).toContain("presence");
    expect(hi[0].id).toContain("main");
  });
});
