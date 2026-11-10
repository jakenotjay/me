import { afterEach, describe, expect, it, vi } from "vitest";
import { MosaicLayer, type COGSource } from "@developmentseed/deck.gl-geotiff";
import type { IndexItem } from "../types";
import type { ExplorerState } from "../state";
import {
  buildDeckLayers,
  setPreparingState,
  isFramePrepared,
  markFramePrepared,
  invalidatePreparedFrames,
  frameLayerIds,
  frameCacheStats,
  preparationProgress,
  disposeDropped,
  isLayerSettled,
  layerFailed,
  layerLoadProgress,
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
  setPreparingState(null);
  buildDeckLayers(st({ visible: [] }), idx, 5); // clears tracking
  disposeDropped();
  markIndexFailed("tmf", false);
  onLayersChanged(null);
  vi.unstubAllGlobals();
});

describe("buildDeckLayers", () => {
  it("renders nothing below minZoom or for hidden layers", () => {
    expect(buildDeckLayers(st({ visible: ["forty-v2"] }), { forty: [{ id: "a", bbox: [0, 0, 1, 1] }] }, 6)).toHaveLength(0);
    expect(buildDeckLayers(st({ visible: [] }), idx, 5)).toHaveLength(0);
  });

  it("renders ForTy v2 overviews one level farther out at zoom 7", () => {
    expect(buildDeckLayers(st({ visible: ["forty-v2"] }), { forty: tmfItems }, 7)).toHaveLength(1);
  });

  it("waits for the index before rendering index-backed layers", () => {
    expect(buildDeckLayers(st({ visible: ["tmf-annual-change"] }), {}, 5)).toHaveLength(0);
  });

  it("builds a single COG layer for non-index layers at any zoom", () => {
    const ls = buildDeckLayers(st({ visible: ["drivers"] }), {}, 2);
    expect(ls).toHaveLength(1);
    expect(ls[0].id).toMatch(/^cog:drivers/);
    expect((ls[0] as unknown as { props: { source: string } }).props.source).toMatch(/^https:.*\.tif$/);
  });

  it("opens ForTy metadata with a 16 KiB range while preserving cancellation", async () => {
    type Item = { id: string; itemId: string; bbox: [number, number, number, number] };
    const [layer] = buildDeckLayers(st({ visible: ["forty-v2"] }), { forty: tmfItems }, 9);
    const props = (layer as MosaicLayer<Item, COGSource>).props;
    const item = (props.data as Item[])[0];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctl = new AbortController();
    ctl.abort();
    await expect(props.getSource!(item, { signal: ctl.signal, reader: props.reader })).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(props.getSource!(item, { reader: props.reader })).rejects.toBeDefined();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("range")).toBe("bytes=0-16383");
  });

  it("uses year-keyed ids so a year change makes a new layer", () => {
    const a = buildDeckLayers(st({ visible: ["tmf-annual-change"], year: 2019 }), idx, 5);
    const b = buildDeckLayers(st({ visible: ["tmf-annual-change"], year: 2020 }), idx, 5);
    expect(a[0].id).not.toBe(b[0].id);
  });

  it("shows only the selected year while its tiles load, including rapid scrubbing", () => {
    const s = (year: number) => st({ visible: ["tmf-annual-change"], year });
    const y1 = buildDeckLayers(s(2019), idx, 5);
    markLoaded(y1[0]);

    const y2 = buildDeckLayers(s(2020), idx, 5);
    expect(ids(y2)).toEqual([expect.stringContaining("2020")]);
    expect(isLayerSettled("tmf-annual-change")).toBe(false);
    expect(ids(buildDeckLayers(s(2020), idx, 5))).toEqual(ids(y2));

    const y3 = buildDeckLayers(s(2021), idx, 5);
    expect(ids(y3)).toEqual([expect.stringContaining("2021")]);
    // A late completion from an abandoned year must not bring it back.
    markLoaded(y2[0]);
    expect(ids(buildDeckLayers(s(2021), idx, 5))).toEqual(ids(y3));
    expect(isLayerSettled("tmf-annual-change")).toBe(false);
    markLoaded(y3[0]);
    expect(isLayerSettled("tmf-annual-change")).toBe(true);
  });

  it("shows only the selected month while a new water frame loads", () => {
    const indexes = { "surface-water": tmfItems };
    const s = (month: string) => st({ visible: ["surface-water"], month });
    const first = buildDeckLayers(s("2023-05"), indexes, 8);
    markLoaded(first[0]);
    expect(ids(buildDeckLayers(s("2023-06"), indexes, 8))).toEqual([expect.stringContaining("2023-06")]);
  });

  it("switches GFT between presence and classes at zoom 14 via the layer id", () => {
    const lo = buildDeckLayers(st({ visible: ["gft-2020"] }), {}, 8);
    const hi = buildDeckLayers(st({ visible: ["gft-2020"] }), {}, 14);
    expect(lo[0].id).toContain("presence");
    expect(hi[0].id).toContain("main");
  });

  it("a source whose header fails settles the selected year without restoring the previous year", () => {
    const changed = vi.fn();
    onLayersChanged(changed);
    const a = buildDeckLayers(st({ visible: ["tmf-annual-change"], year: 2019 }), idx, 5);
    markLoaded(a[0]);
    const b = buildDeckLayers(st({ visible: ["tmf-annual-change"], year: 2020 }), idx, 5);
    expect(b).toHaveLength(1);
    const mosaic = b[0] as unknown as {
      props: {
        onViewportLoad: (e: unknown[]) => void;
        onSourceError: (s: { id: string; itemId: string }, info: { error: Error }) => void;
      };
    };
    const srcId = (mosaic as unknown as { props: { data: { id: string }[] } }).props.data[0].id;
    mosaic.props.onViewportLoad([{ item: { id: srcId }, source: undefined }]);
    expect(changed).not.toHaveBeenCalled();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mosaic.props.onSourceError({ id: srcId, itemId: "S10_W70" }, { error: new Error("503") });
    expect(isLayerSettled("tmf-annual-change")).toBe(true);
    expect(ids(buildDeckLayers(st({ visible: ["tmf-annual-change"], year: 2020 }), idx, 5))).toHaveLength(1);
  });

  it("does not rebuild sources when rendered twice with the same key", () => {
    const s = st({ visible: ["forty-v2"] });
    const big = Array.from({ length: 1000 }, (_, i) => ({ id: `i${i}`, bbox: [0, 0, 1, 1] as [number, number, number, number] }));
    const a = buildDeckLayers(s, { forty: big }, 9) as unknown as { props: { data: unknown } }[];
    const b = buildDeckLayers({ ...s, opacity: { "forty-v2": 0.3 } }, { forty: big }, 9) as unknown as { props: { data: unknown } }[];
    expect(b[0].props.data).toBe(a[0].props.data);
  });

  it("renderSource shares the opened source and inherits mosaic sublayer props", () => {
    const l = buildDeckLayers(st({ visible: ["tmf-annual-change"] }), idx, 5)[0] as never as {
      props: { data: { id: string; itemId: string }[]; renderSource: (s: unknown, options: unknown) => { props: { source: unknown; id: string; opacity: number } } };
    };
    const src = l.props.data[0];
    const opened = { geographicBounds: [-70, -10, -60, 0] };
    const layer = l.props.renderSource(src, { source: opened, subLayerProps: { id: "mosaic-child", opacity: 0.4 } });
    expect(layer.props.source).toBe(opened);
    expect(layer.props.id).toBe("mosaic-child");
    expect(layer.props.opacity).toBe(0.4);
  });
});

// A device whose textures just record destroy calls.
function fakeTile(layer: unknown, pixels = 4) {
  const destroyed: object[] = [];
  const device = { createTexture: () => ({ destroy() { destroyed.push(this); } }) };
  const props = (layer as { props: { getTileData: (i: unknown, o: unknown) => Promise<{ texture: { destroy(): void } }>; onTileUnload: (t: unknown) => void } }).props;
  const image = { fetchTile: async () => ({ array: { layout: "band-separate", bands: [new Uint8Array(pixels)], width: 2, height: pixels / 2 } }) };
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

  it("releases the old year's textures as soon as the selected year changes", async () => {
    const s = (year: number) => st({ visible: ["tmf-annual-change"], year });
    const y1 = buildDeckLayers(s(2019), idx, 5);
    markLoaded(y1[0]);
    const src = (y1[0] as never as { props: { data: { id: string; itemId: string }[]; renderSource: (x: unknown, options: unknown) => unknown } }).props;
    const t = fakeTile(src.renderSource(src.data[0], { source: {}, subLayerProps: { id: "child" } }));
    await t.make();
    const y2 = buildDeckLayers(s(2020), idx, 5);
    expect(ids(y2)).toEqual([expect.stringContaining("2020")]);
    expect(isLayerSettled("tmf-annual-change")).toBe(false);
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
      props: { data: { id: string; itemId: string }[]; onSourceError: (item: unknown, info: { error: Error }) => void };
    };
    expect(layerFailed(def)).toBe(false);
    a.props.onSourceError(a.props.data[0], { error: new Error("503") });
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


describe("timestep loading progress", () => {
  it("counts loaded and failed viewport sources, and resets on a time change", () => {
    type Item = { id: string; itemId: string; bbox: [number, number, number, number] };
    const items: IndexItem[] = [...tmfItems, { id: "S10_W60", bbox: [-60, -10, -50, 0] }];
    const state = st({ visible: ["tmf-annual-change"], year: 2019 });
    const [layer] = buildDeckLayers(state, { tmf: items }, 5);
    const props = (layer as MosaicLayer<Item, COGSource>).props;
    const data = props.data as Item[];
    expect(layerLoadProgress("tmf-annual-change")).toEqual({ loaded: 0, total: null, failed: 0, settled: false });
    props.onViewportLoad!(data.map((item) => ({ item })));
    expect(layerLoadProgress("tmf-annual-change")).toEqual({ loaded: 0, total: 2, failed: 0, settled: false });
    markLoaded(props.renderSource(data[0], { source: {} as COGSource, subLayerProps: { id: "first" } }));
    expect(layerLoadProgress("tmf-annual-change")).toEqual({ loaded: 1, total: 2, failed: 0, settled: false });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    props.onSourceError!(data[1], { error: new Error("503") });
    expect(layerLoadProgress("tmf-annual-change")).toEqual({ loaded: 1, total: 2, failed: 1, settled: true });
    buildDeckLayers({ ...state, year: 2020 }, { tmf: items }, 5);
    expect(layerLoadProgress("tmf-annual-change")).toEqual({ loaded: 0, total: null, failed: 0, settled: false });
  });
});


describe("prepared GPU frames", () => {
  const state = (year: number) => st({ visible: ["tmf-annual-change"], year });
  const rootFor = (layers: ReturnType<typeof buildDeckLayers>, year: number) =>
    layers.find((layer) => layer.id.includes(`|${year}|`))!;
  type Item = { id: string; itemId: string; bbox: [number, number, number, number] };

  it("keeps a warmed frame mounted invisibly and promotes it without changing layer ids", () => {
    const selected = state(2019);
    const target = state(2020);
    const first = buildDeckLayers(selected, idx, 5);
    markLoaded(first[0]);
    markFramePrepared(selected, 5);
    setPreparingState(target);
    const warming = buildDeckLayers(selected, idx, 5);
    const pending = rootFor(warming, 2020);
    expect(rootFor(warming, 2019).props.opacity).toBeGreaterThan(0);
    expect(pending.props.visible).toBe(true);
    expect(pending.props.opacity).toBe(0);
    expect(isFramePrepared(target, 5)).toBe(false);
    markLoaded(pending);
    markFramePrepared(target, 5);
    expect(isFramePrepared(target, 5)).toBe(true);
    setPreparingState(null);
    const cached = buildDeckLayers(selected, idx, 5);
    expect(rootFor(cached, 2020).props.visible).toBe(false);
    const promoted = buildDeckLayers(target, idx, 5);
    expect(rootFor(promoted, 2020).id).toBe(pending.id);
    expect(rootFor(promoted, 2020).props.visible).toBe(true);
    expect(rootFor(promoted, 2020).props.opacity).toBeGreaterThan(0);
    expect(rootFor(promoted, 2019).props.visible).toBe(false);
    expect(frameLayerIds(target, 5)).toEqual([pending.id]);
  });

  it("shares the same source geometry between different years", () => {
    const [first] = buildDeckLayers(state(2019), idx, 5) as MosaicLayer<Item, COGSource>[];
    setPreparingState(state(2020));
    const next = rootFor(buildDeckLayers(state(2019), idx, 5), 2020) as MosaicLayer<Item, COGSource>;
    expect(next.props.data).toBe(first.props.data);
    expect((next.props.data as Item[])[0].itemId).toBe("S10_W70");
  });

  it("disposes invalidated cached textures after their layers leave the overlay", async () => {
    const selected = state(2019);
    const target = state(2020);
    buildDeckLayers(selected, idx, 5);
    setPreparingState(target);
    const targetLayer = rootFor(buildDeckLayers(selected, idx, 5), 2020) as MosaicLayer<Item, COGSource>;
    const props = targetLayer.props;
    const item = (props.data as Item[])[0];
    const t = fakeTile(props.renderSource(item, { source: {} as COGSource, subLayerProps: { id: "prepared-child" } }));
    const tile = await t.make();
    markLoaded(targetLayer);
    markFramePrepared(target, 5);
    setPreparingState(null);
    buildDeckLayers(selected, idx, 5);
    invalidatePreparedFrames();
    expect(isFramePrepared(target, 5)).toBe(false);
    expect(buildDeckLayers(selected, idx, 5).map((l) => l.id)).not.toContain(targetLayer.id);
    expect(t.destroyed).toEqual([]);
    disposeDropped();
    expect(t.destroyed).toEqual([tile.texture]);
    t.unload(tile);
    disposeDropped();
    expect(t.destroyed).toHaveLength(1);
  });

  it.each(["source", "tile"])("does not mark a frame prepared after a %s failure", (failure) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = state(2020);
    const [layer] = buildDeckLayers(target, idx, 5) as MosaicLayer<Item, COGSource>[];
    const props = layer.props;
    const item = (props.data as Item[])[0];
    props.onViewportLoad!([{ item }]);
    if (failure === "source") props.onSourceError!(item, { error: new Error("failed header") });
    else {
      const child = props.renderSource(item, { source: {} as COGSource, subLayerProps: { id: "failed-child" } }) as unknown as { props: { onTileError: (error: Error) => void; onViewportLoad: () => void } };
      child.props.onTileError(new Error("failed tile"));
      child.props.onViewportLoad();
    }
    markFramePrepared(target, 5);
    expect(isFramePrepared(target, 5)).toBe(false);
  });
});


it("reports a missing index failure while preparing a target without a generation", () => {
  const target = st({ visible: ["tmf-annual-change"], year: 2020 });
  markIndexFailed("tmf", true);
  expect(preparationProgress(target, 5)).toEqual([expect.objectContaining({ failed: 1, settled: true })]);
  expect(isFramePrepared(target, 5)).toBe(false);
});


it("keeps recreated dates separate from GPU state awaiting disposal during rapid scrubbing", async () => {
  const s = (year: number) => st({ visible: ["tmf-annual-change"], year });
  const a = buildDeckLayers(s(2017), idx, 5)[0];
  const firstProps = (a as MosaicLayer).props;
  const first = fakeTile(firstProps.renderSource((firstProps.data as { id: string; bbox: [number, number, number, number] }[])[0], { source: {}, subLayerProps: { id: "old-child" } }));
  await first.make();
  buildDeckLayers(s(2018), idx, 5);
  const again = buildDeckLayers(s(2017), idx, 5)[0];
  expect(again.id).not.toBe(a.id);
  const nextProps = (again as MosaicLayer).props;
  const next = fakeTile(nextProps.renderSource((nextProps.data as { id: string; bbox: [number, number, number, number] }[])[0], { source: {}, subLayerProps: { id: "new-child" } }));
  await next.make();
  disposeDropped();
  expect(first.destroyed).toHaveLength(1);
  expect(next.destroyed).toHaveLength(0);
  expect(liveTextureCount()).toBe(1);
});

it("knows the historical frame's visible-area total before opening its COG headers", () => {
  type Item = { id: string; itemId: string; bbox: [number, number, number, number] };
  const state = st({ visible: ["tmf-annual-change"], year: 2025 });
  const items = [...tmfItems, { id: "S10_W60", bbox: [-60, -10, -50, 0] as [number, number, number, number] }];
  const [visible] = buildDeckLayers(state, { tmf: items }, 5);
  const props = (visible as MosaicLayer<Item, COGSource>).props;
  const data = props.data as Item[];
  props.onViewportLoad!(data.map((item) => ({ item })));
  for (const item of data) markLoaded(props.renderSource(item, { source: {} as COGSource, subLayerProps: { id: item.id } }));
  markFramePrepared(state, 5);
  const historical = { ...state, year: 2017 };
  setPreparingState(historical);
  buildDeckLayers(state, { tmf: items }, 5);
  expect(preparationProgress(historical, 5)).toEqual([{ loaded: 0, total: 2, failed: 0, settled: false }]);
});


it("retains all nine prepared frames when a Retina viewport needs more than 64 MiB", async () => {
  type Item = { id: string; itemId: string; bbox: [number, number, number, number] };
  const current = st({ visible: ["tmf-annual-change"], year: 2025 });
  const prepare = async (target: ExplorerState) => {
    setPreparingState(target.year === 2025 ? null : target);
    const layers = buildDeckLayers(current, idx, 5);
    const root = layers.find((l) => l.id === frameLayerIds(target, 5)[0]) as MosaicLayer<Item, COGSource>;
    const item = (root.props.data as Item[])[0];
    const child = root.props.renderSource(item, { source: {} as COGSource, subLayerProps: { id: `child-${target.year}` } });
    await fakeTile(child, 8 * 1024 * 1024).make();
    markLoaded(child);
    root.props.onViewportLoad!([{ item }]);
    markFramePrepared(target, 5);
    setPreparingState(null);
    buildDeckLayers(current, idx, 5);
  };
  await prepare(current);
  for (let year = 2017; year < 2025; year++) await prepare({ ...current, year });
  expect(frameCacheStats().usedBytes).toBe(72 * 1024 * 1024);
  for (let year = 2017; year <= 2025; year++) expect(isFramePrepared({ ...current, year }, 5)).toBe(true);
});

it("retains all 36 small TMF annual frames without an arbitrary timestep-count limit", async () => {
  type Item = { id: string; itemId: string; bbox: [number, number, number, number] };
  const current = st({ visible: ["tmf-annual-change"], year: 2025 });
  for (const year of [2025, ...Array.from({ length: 35 }, (_, i) => 1990 + i)]) {
    const target = { ...current, year };
    setPreparingState(year === 2025 ? null : target);
    const root = buildDeckLayers(current, idx, 5).find((l) => l.id === frameLayerIds(target, 5)[0]) as MosaicLayer<Item, COGSource>;
    const item = (root.props.data as Item[])[0];
    const child = root.props.renderSource(item, { source: {} as COGSource, subLayerProps: { id: `tmf-${year}` } });
    await fakeTile(child).make();
    markLoaded(child);
    root.props.onViewportLoad!([{ item }]);
    markFramePrepared(target, 5);
    setPreparingState(null);
    buildDeckLayers(current, idx, 5);
  }
  expect(frameCacheStats().usedBytes).toBe(36 * 4);
  for (let year = 1990; year <= 2025; year++) expect(isFramePrepared({ ...current, year }, 5)).toBe(true);
});
