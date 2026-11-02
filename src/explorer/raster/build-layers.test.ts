import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexItem } from "../types";
import type { ExplorerState } from "../state";
import {
  buildDeckLayers,
  disposeDropped,
  isLayerSettled,
  layerFailed,
  liveTextureCount,
  markIndexFailed,
  onLayersChanged,
} from "./layers";
import { layerById } from "../catalog";

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
  disposeDropped();
  markIndexFailed("tmf", false);
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

  it("a source whose header fails counts as settled and drops the previous year", () => {
    const changed = vi.fn();
    onLayersChanged(changed);
    const a = buildDeckLayers(st({ visible: ["tmf-annual-change"], year: 2019 }), idx, 5);
    markLoaded(a[0]);
    const b = buildDeckLayers(st({ visible: ["tmf-annual-change"], year: 2020 }), idx, 5);
    expect(b).toHaveLength(2);
    const mosaic = b[1] as unknown as {
      props: {
        onViewportLoad: (e: unknown[]) => void;
        renderSource: (s: { id: string; itemId: string }) => { props: { onError: (e: Error) => void } };
      };
    };
    const srcId = (mosaic as unknown as { props: { sources: { id: string }[] } }).props.sources[0].id;
    mosaic.props.onViewportLoad([{ source: { id: srcId } }]);
    expect(changed).not.toHaveBeenCalled();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mosaic.props.renderSource({ id: srcId, itemId: "S10_W70" }).props.onError(new Error("503"));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(ids(buildDeckLayers(st({ visible: ["tmf-annual-change"], year: 2020 }), idx, 5))).toHaveLength(1);
  });

  it("does not rebuild sources when rendered twice with the same key", () => {
    const s = st({ visible: ["forty-v2"] });
    const big = Array.from({ length: 1000 }, (_, i) => ({ id: `i${i}`, bbox: [0, 0, 1, 1] as [number, number, number, number] }));
    const a = buildDeckLayers(s, { forty: big }, 9) as unknown as { props: { sources: unknown } }[];
    const b = buildDeckLayers({ ...s, opacity: { "forty-v2": 0.3 } }, { forty: big }, 9) as unknown as { props: { sources: unknown } }[];
    expect(b[0].props.sources).toBe(a[0].props.sources);
  });

  it("renderSource uses the itemId carried on the source", () => {
    const l = buildDeckLayers(st({ visible: ["tmf-annual-change"] }), idx, 5)[0] as never as {
      props: { sources: { id: string; itemId: string }[]; renderSource: (s: unknown) => { props: { geotiff: string } } };
    };
    const src = l.props.sources[0];
    expect(l.props.renderSource(src).props.geotiff).toContain("S10_W70");
  });
});

// A device whose textures just record destroy calls.
function fakeTile(layer: unknown) {
  const destroyed: object[] = [];
  const device = { createTexture: () => ({ destroy() { destroyed.push(this); } }) };
  const props = (layer as { props: { getTileData: (i: unknown, o: unknown) => Promise<{ texture: { destroy(): void } }>; onTileUnload: (t: unknown) => void } }).props;
  const image = { fetchTile: async () => ({ array: { layout: "band-separate", bands: [new Uint8Array(4)], width: 2, height: 2 } }) };
  const make = () => props.getTileData(image, { device, x: 0, y: 0 });
  return { destroyed, make, unload: (content: unknown) => props.onTileUnload({ content }) };
}

describe("texture bookkeeping", () => {
  it("destroys the remaining textures once when a generation is dropped, not those already unloaded", async () => {
    const [driv] = buildDeckLayers(st({ visible: ["drivers"] }), {}, 5);
    const t = fakeTile(driv);
    const a = await t.make();
    const b = await t.make();
    const c = await t.make();
    expect(liveTextureCount()).toBe(3);
    t.unload(a); // eviction by deck
    expect(t.destroyed).toEqual([a.texture]);
    expect(liveTextureCount()).toBe(2);

    buildDeckLayers(st({ visible: [] }), {}, 5); // layer toggled off: its track is dropped
    expect(t.destroyed).toHaveLength(1); // not before the overlay stops drawing it
    disposeDropped();
    expect(t.destroyed).toHaveLength(3);
    expect(t.destroyed).toEqual(expect.arrayContaining([a.texture, b.texture, c.texture]));
    disposeDropped();
    t.unload(b); // late unload of an already-destroyed texture: no double destroy
    expect(t.destroyed).toHaveLength(3);
    expect(liveTextureCount()).toBe(0);
  });

  it("destroys a tile that finishes after its generation was dropped", async () => {
    const [driv] = buildDeckLayers(st({ visible: ["drivers"] }), {}, 5);
    const t = fakeTile(driv);
    buildDeckLayers(st({ visible: [] }), {}, 5);
    disposeDropped();
    const late = await t.make();
    expect(t.destroyed).toEqual([late.texture]);
  });

  it("drops the previous generation's textures when the new year finishes", async () => {
    const s = (year: number) => st({ visible: ["tmf-annual-change"], year });
    const y1 = buildDeckLayers(s(2019), idx, 5);
    markLoaded(y1[0]);
    const src = (y1[0] as never as { props: { sources: { id: string; itemId: string }[]; renderSource: (x: unknown) => unknown } }).props;
    const t = fakeTile(src.renderSource(src.sources[0]));
    await t.make();
    const y2 = buildDeckLayers(s(2020), idx, 5);
    markLoaded(y2[1]);
    expect(t.destroyed).toHaveLength(0);
    disposeDropped();
    expect(t.destroyed).toHaveLength(1);
  });
});

describe("failure state", () => {
  it("flags a layer after a source error and clears with a clean later generation", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const def = layerById("tmf-annual-change")!;
    const s = (year: number) => st({ visible: ["tmf-annual-change"], year });
    const a = buildDeckLayers(s(2019), idx, 5)[0] as never as {
      props: { sources: { id: string; itemId: string }[]; renderSource: (x: unknown) => { props: { onError: (e: Error) => void } } };
    };
    expect(layerFailed(def)).toBe(false);
    a.props.renderSource(a.props.sources[0]).props.onError(new Error("503"));
    expect(layerFailed(def)).toBe(true);
    buildDeckLayers(s(2020), idx, 5); // new generation, clean
    expect(layerFailed(def)).toBe(false);
  });

  it("flags a layer whose index failed to load", () => {
    const def = layerById("tmf-annual-change")!;
    markIndexFailed(def.index!, true);
    expect(layerFailed(def)).toBe(true);
    markIndexFailed(def.index!, false);
    expect(layerFailed(def)).toBe(false);
  });

  it("isLayerSettled is true for layers not rendered and false while loading", () => {
    expect(isLayerSettled("tmf-annual-change")).toBe(true);
    const l = buildDeckLayers(st({ visible: ["tmf-annual-change"] }), idx, 5);
    expect(isLayerSettled("tmf-annual-change")).toBe(false);
    markLoaded(l[0]);
    expect(isLayerSettled("tmf-annual-change")).toBe(true);
  });
});
