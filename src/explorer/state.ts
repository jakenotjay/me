import type { LayerDef } from "./types";

export type ExplorerState = {
  visible: string[];
  opacity: Record<string, number>;
  year: number;
  month: string;
  basemap: "satellite" | "osm" | "none";
  inspect: boolean;
  view: { lon: number; lat: number; zoom: number };
  controlsOpen: boolean;
};

export type Store = {
  get(): ExplorerState;
  set(patch: Partial<ExplorerState>): void;
  subscribe(fn: (s: ExplorerState) => void): void;
};

// Rondônia; Task 7 finalises the default view.
export const DEFAULT_VIEW = { lon: -63.0, lat: -10.0, zoom: 11 };
const BASEMAPS = ["satellite", "osm", "none"] as const;

export function defaultState(): ExplorerState {
  return {
    visible: ["forty-v2"],
    opacity: {},
    year: 2025,
    month: "2024-12",
    basemap: "satellite",
    inspect: false,
    view: { ...DEFAULT_VIEW },
    controlsOpen: false,
  };
}

export function createStore(initial: ExplorerState): Store {
  let state = initial;
  const subs: Array<(s: ExplorerState) => void> = [];
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const fn of subs) fn(state);
    },
    subscribe: (fn) => void subs.push(fn),
  };
}

/** Nearest available year in `def.years`; undefined if the layer has no years. */
export function yearFor(def: LayerDef, year: number): number | undefined {
  if (!def.years?.length) return undefined;
  let best = def.years[0];
  for (const y of def.years) if (Math.abs(y - year) < Math.abs(best - year)) best = y;
  return best;
}

/** Nearest available month (`YYYY-MM`) in `def.months`; undefined without months. */
export function monthFor(def: LayerDef, month: string): string | undefined {
  const ms = def.months;
  if (!ms?.length) return undefined;
  if (ms.includes(month)) return month;
  if (month < ms[0]) return ms[0];
  return ms[ms.length - 1];
}

/** Union of the year ranges of the visible time-enabled layers, or null if none. */
export function timeRange(s: ExplorerState, defs: LayerDef[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of s.visible) {
    const ys = defs.find((d) => d.id === id)?.years;
    if (!ys?.length) continue;
    for (const y of ys) {
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

const r = (n: number, d: number) => Number(n.toFixed(d));

export function encodeHash(s: ExplorerState): string {
  const p = new URLSearchParams();
  p.set("v", `${r(s.view.lon, 4)},${r(s.view.lat, 4)},${r(s.view.zoom, 2)}`);
  p.set("l", s.visible.join(","));
  p.set("y", String(s.year));
  p.set("m", s.month);
  p.set("b", s.basemap);
  const ops = Object.entries(s.opacity).map(([id, v]) => `${id}:${r(v, 2)}`);
  if (ops.length) p.set("o", ops.join(","));
  if (s.inspect) p.set("i", "1");
  return "#" + p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
}

export function decodeHash(hash: string, defs: LayerDef[]): ExplorerState {
  const out = defaultState();
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const known = new Set(defs.map((d) => d.id));

  const v = p.get("v")?.split(",").map(Number);
  if (
    v?.length === 3 &&
    v.every(Number.isFinite) &&
    Math.abs(v[0]) <= 180 &&
    Math.abs(v[1]) <= 85.06 &&
    v[2] >= 0 &&
    v[2] <= 24
  ) {
    out.view = { lon: v[0], lat: v[1], zoom: v[2] };
  }

  const l = p.get("l");
  if (l !== null) out.visible = [...new Set(l.split(",").filter((id) => known.has(id)))];

  const y = Number(p.get("y"));
  if (p.has("y") && defs.some((d) => d.years?.includes(y))) out.year = y;

  const m = p.get("m");
  if (m && defs.some((d) => d.months?.includes(m))) out.month = m;

  const b = p.get("b");
  if (b && (BASEMAPS as readonly string[]).includes(b)) out.basemap = b as ExplorerState["basemap"];

  const o = p.get("o");
  if (o) {
    for (const part of o.split(",")) {
      const [id, val] = part.split(":");
      const n = Number(val);
      if (known.has(id) && val !== "" && Number.isFinite(n) && n >= 0 && n <= 1) out.opacity[id] = n;
    }
  }

  out.inspect = p.get("i") === "1";
  return out;
}
