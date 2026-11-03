import { LAYERS } from "./catalog";
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

// Northern Mato Grosso, Brazil: a forest frontier where ForTy v2 visibly changes between 2017 and 2025
// (primary forest turning "regrowing", cleared patches reclaimed). Above ForTy's minZoom of 8.
export const DEFAULT_VIEW = { lon: -55.0, lat: -11.0, zoom: 9 };
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

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const monthIndex = (m: string): number => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
export const monthAt = (i: number): string => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

/**
 * The time bar's unit. When a visible layer has months (surface water) the bar works in months over the union of
 * those months and the yearly layers' years (Jan of the first year to Dec of the last); otherwise in years.
 */
export type TimeAxis = { unit: "month"; range: [string, string] } | { unit: "year"; range: [number, number] };

export function timeAxis(s: ExplorerState, defs: LayerDef[] = LAYERS): TimeAxis | null {
  const years = timeRange(s, defs);
  let lo = Infinity;
  let hi = -Infinity;
  let any = false;
  for (const id of s.visible) {
    const ms = defs.find((d) => d.id === id)?.months;
    if (!ms?.length) continue;
    any = true;
    lo = Math.min(lo, monthIndex(ms[0]));
    hi = Math.max(hi, monthIndex(ms[ms.length - 1]));
  }
  if (!any) return years ? { unit: "year", range: years } : null;
  if (years) {
    lo = Math.min(lo, years[0] * 12);
    hi = Math.max(hi, years[1] * 12 + 11);
  }
  return { unit: "month", range: [monthAt(lo), monthAt(hi)] };
}

/** Union of the months of the visible month layers (what the map can show), or null. */
export function monthLayerRange(s: ExplorerState, defs: LayerDef[] = LAYERS): [string, string] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of s.visible) {
    const ms = defs.find((d) => d.id === id)?.months;
    if (!ms?.length) continue;
    lo = Math.min(lo, monthIndex(ms[0]));
    hi = Math.max(hi, monthIndex(ms[ms.length - 1]));
  }
  return lo <= hi ? [monthAt(lo), monthAt(hi)] : null;
}

/**
 * Patch for toggling layer `id`. Turning a month layer on while a yearly layer is visible seeds `month` from
 * the current year (`YYYY-01`) so the yearly layer does not jump (the month layer then shows its nearest month).
 */
export function toggleLayer(s: ExplorerState, id: string, on: boolean, defs: LayerDef[] = LAYERS): Partial<ExplorerState> {
  const vis = s.visible.filter((v) => v !== id);
  // Newly shown layers go on top (last in the draw order).
  const patch: Partial<ExplorerState> = { visible: on ? [...vis, id] : vis };
  const def = defs.find((d) => d.id === id);
  const hasYearly = vis.some((v) => defs.find((d) => d.id === v)?.years?.length);
  const hasMonthly = vis.some((v) => defs.find((d) => d.id === v)?.months?.length);
  if (on && def?.months?.length && hasYearly && !hasMonthly) patch.month = `${s.year}-01`;
  return patch;
}

/** The selected month clamped into a month axis. */
export function clampMonth(m: string, range: [string, string]): string {
  return monthIndex(m) < monthIndex(range[0]) ? range[0] : monthIndex(m) > monthIndex(range[1]) ? range[1] : m;
}

/**
 * The year yearly layers should use. While a month layer is visible the time bar is in months, so it is the
 * year of the selected month; otherwise the plain year slider value.
 */
export function activeYear(s: ExplorerState, defs: LayerDef[] = LAYERS): number {
  const axis = timeAxis(s, defs);
  return axis?.unit === "month" ? Number(clampMonth(s.month, axis.range).slice(0, 4)) : s.year;
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
  // Any real month the time bar can reach (it spans the yearly layers' years too), not only the map's months.
  const mm = m ? MONTH_RE.exec(m) : null;
  if (mm && Number(mm[1]) >= 1984 && Number(mm[1]) <= 2030) out.month = m!;

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
