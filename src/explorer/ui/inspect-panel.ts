import { layerById, SURFACE_WATER_SEAM } from "../catalog";
import { decodeValue } from "../inspect/decode";
import { mapLimit, runReads, type ReadJob } from "../inspect/coordinator";
import { readLayerPoint } from "../inspect/pixel";
import { itemsAt, loadIndex } from "../indexes";
import { activeYear, clampMonth, monthFor, yearFor, type ExplorerState, type Store } from "../state";
import type { IndexItem, LayerDef } from "../types";
import { forTyChart, tmfStrip, WATER_FAILED_NOTE, waterStrip } from "./chart";
import { displayTitle, el } from "./dom";

export type InspectPoint = { lon: number; lat: number };

type Result =
  | { kind: "single"; values: number[] | null }
  | { kind: "forty"; years: number[]; bands: (number[] | null)[] }
  | { kind: "strip"; years: number[]; values: (number[] | null)[] }
  | { kind: "water"; months: string[]; values: (number[] | null | typeof FAILED)[] };

/** A month whose read failed for a reason other than 404 (a 404 is a plain null: no observation). */
const FAILED = "failed" as const;
/** Months read at once per click; unstarted months stop when a newer click aborts. */
const WATER_CONCURRENCY = 24;

const phone = () => window.matchMedia("(max-width: 600px)").matches;

/** Which reads a layer needs: one value, or one per year (ForTy bands / TMF annual classes) or per month (surface water). */
function resultKind(def: LayerDef): Result["kind"] {
  if (def.inspectMonths?.length) return "water";
  if (!def.years?.length) return "single";
  return def.render === "forty-argmax" ? "forty" : "strip";
}

async function itemsFor(def: LayerDef, p: InspectPoint): Promise<IndexItem[] | undefined> {
  if (!def.index) return undefined;
  return itemsAt(await loadIndex(def.index), p.lon, p.lat);
}

async function readLayer(def: LayerDef, p: InspectPoint, month: string, signal: AbortSignal): Promise<Result> {
  const items = await itemsFor(def, p);
  const kind = resultKind(def);
  if (kind === "single") {
    return { kind, values: await readLayerPoint(def, items, { month }, p.lon, p.lat, signal) };
  }
  if (kind === "water") {
    // 96 months, WATER_CONCURRENCY at a time through the shared limiter. A missing file (404) reads as null:
    // no observation. Any other failure is its own result, so it never passes for "no observation".
    const months = def.inspectMonths!;
    const values = await mapLimit(
      months,
      WATER_CONCURRENCY,
      (m) =>
        readLayerPoint(def, items, { month: m }, p.lon, p.lat, signal).catch((err) => {
          if (signal.aborted) throw err;
          return FAILED;
        }),
      signal,
    );
    return { kind, months, values };
  }
  // All years in parallel; the shared limiter (SOURCE_COOP_MAX_REQUESTS) keeps this polite.
  const years = def.years!;
  const reads = await Promise.all(
    years.map((year) =>
      readLayerPoint(def, items, { year }, p.lon, p.lat, signal).catch((err) => {
        if (signal.aborted) throw err;
        return null;
      }),
    ),
  );
  return kind === "forty" ? { kind, years, bands: reads } : { kind, years, values: reads };
}

/**
 * The Pixel panel (`#left`). Returns `inspectAt`, which is what a map click does (and what e2e tests call),
 * and `clear`. `onPoint` receives the marker position (null when cleared).
 */
export function mountInspectPanel(
  root: HTMLElement,
  store: Store,
  opts: { onPoint?: (p: InspectPoint | null) => void } = {},
): { inspectAt(lon: number, lat: number): void; clear(): void } {
  const title = el("h1", "", "Pixel");
  const fold = el("button", "fold", "Fold");
  fold.type = "button";
  const close = el("button", "closebtn", "Close");
  close.type = "button";
  close.setAttribute("aria-label", "Close pixel panel");
  const btns = el("span", "hbtns", [fold, close]);
  const header = el("header", "", [title, btns]);
  const body = el("div", "body");
  root.replaceChildren(header, body);

  let point: InspectPoint | null = null;
  let controller: AbortController | null = null;
  const results = new Map<string, Result | "loading">();

  // A month-strip layer reads all its months once, so its key does not depend on the selected month.
  const keyFor = (def: LayerDef, s: ExplorerState) =>
    `${def.id}|${def.months && !def.inspectMonths ? monthFor(def, s.month) : ""}`;
  const readable = (def: LayerDef, s: ExplorerState) => s.view.zoom >= def.minZoom;

  function ensureReads() {
    if (!point || !controller) return;
    const s = store.get();
    const ctl = controller;
    const p = point;
    const jobs: ReadJob<Result>[] = [];
    for (const id of s.visible) {
      const def = layerById(id);
      if (!def || !readable(def, s)) continue;
      const key = keyFor(def, s);
      if (results.has(key)) continue;
      results.set(key, "loading");
      jobs.push({ key, read: () => readLayer(def, p, s.month, ctl.signal) });
    }
    void runReads(jobs, {
      isCurrent: () => controller === ctl && !ctl.signal.aborted,
      onResult: (key, r) => {
        results.set(key, r);
        render();
      },
      onFail: (key, err) => {
        console.warn(`inspect ${key} failed`, err);
        results.set(key, { kind: "single", values: null });
        render();
      },
    });
  }

  function section(def: LayerDef, s: ExplorerState): HTMLElement {
    const box = el("div", "pxlayer");
    const head = el("div", "ltitle", displayTitle(def.title));
    box.append(head);
    if (!readable(def, s)) {
      box.append(el("div", "note warn", `Zoom in to read this layer (zoom ${def.minZoom}+).`));
      return box;
    }
    const r = results.get(keyFor(def, s));
    if (r === undefined || r === "loading") {
      box.append(el("div", "note", "loading…"));
      return box;
    }
    const year = yearFor(def, activeYear(s));
    let values: number[] | null;
    let shownFailed = false;
    let shownMonth = def.months ? monthFor(def, s.month) : undefined;
    if (r.kind === "single") values = r.values;
    else if (r.kind === "water") {
      // The strip reaches back past the map's months: the header and value follow the selected month inside it.
      shownMonth = clampMonth(s.month, [r.months[0], r.months[r.months.length - 1]]);
      const v = r.values[r.months.indexOf(shownMonth)];
      values = v === FAILED ? null : (v ?? null);
      shownFailed = v === FAILED;
    } else {
      const i = r.years.indexOf(year ?? -1);
      values = i >= 0 ? (r.kind === "forty" ? r.bands[i] : r.values[i]) : null;
    }
    if (shownMonth) head.append(" ", el("span", "mono", shownMonth));
    else if (year !== undefined) head.append(" ", el("span", "mono", String(year)));
    const d = decodeValue(def, values);
    if (r.kind === "water" && d.label === "no data") d.label = shownFailed ? "Failed to load" : "No observation";
    const sw = el("i", "sq");
    if (d.color) sw.style.background = d.color;
    else sw.hidden = true;
    box.append(el("div", "pxval", [sw, el("b", "", d.label)]));
    if (d.detail) box.append(el("div", "note", d.detail));
    if (r.kind === "water") {
      if (r.values.includes(FAILED)) box.append(el("div", "note warn", WATER_FAILED_NOTE));
      box.append(
        waterStrip(
          def,
          r.months.map((m, i) => ({ month: m, value: r.values[i] === FAILED ? FAILED : ((r.values[i] as number[] | null)?.[0] ?? null) })),
          shownMonth!,
          SURFACE_WATER_SEAM,
        ),
      );
    } else if (r.kind === "forty") {
      box.append(forTyChart(def, r.years.map((y, i) => ({ year: y, bands: r.bands[i] })), year ?? s.year));
    } else if (r.kind === "strip") {
      box.append(
        tmfStrip(
          def,
          r.years.map((y, i) => ({ year: y, value: decodeValue(def, r.values[i]).label === "no data" ? null : r.values[i]![0] })),
          year ?? s.year,
        ),
      );
    }
    return box;
  }

  function render() {
    if (!point) return;
    const s = store.get();
    const nodes: Node[] = [
      el("div", "mono coords", `lon ${point.lon.toFixed(5)} · lat ${point.lat.toFixed(5)}`),
    ];
    const defs = [...s.visible].reverse().map(layerById).filter((d): d is LayerDef => !!d);
    if (!defs.length) nodes.push(el("div", "note", "No layers are visible."));
    for (const def of defs) nodes.push(section(def, s));
    body.replaceChildren(...nodes);
  }

  function clear() {
    controller?.abort();
    controller = null;
    point = null;
    results.clear();
    root.hidden = true;
    body.replaceChildren();
    opts.onPoint?.(null);
  }

  function inspectAt(lon: number, lat: number) {
    if (!store.get().inspect) return;
    controller?.abort();
    controller = new AbortController();
    results.clear();
    point = { lon, lat };
    root.hidden = false;
    body.hidden = false;
    fold.textContent = "Fold";
    if (phone()) {
      // A phone has room for one bottom sheet.
      if (store.get().controlsOpen) store.set({ controlsOpen: false });
      const about = document.getElementById("about");
      if (about && !about.hidden) {
        about.hidden = true;
        document.querySelector('#topbtns [aria-label="About this page"]')?.setAttribute("aria-expanded", "false");
      }
    }
    lastSig = "";
    opts.onPoint?.(point);
    render();
    ensureReads();
  }

  fold.addEventListener("click", () => {
    body.hidden = !body.hidden;
    fold.textContent = body.hidden ? "Unfold" : "Fold";
  });
  close.addEventListener("click", clear);
  window.addEventListener("explorer:close-pixel", () => {
    if (phone()) clear();
  });

  let lastSig = "";
  let wasInspect = store.get().inspect;
  store.subscribe((s) => {
    if (!s.inspect && wasInspect) clear();
    wasInspect = s.inspect;
    if (!point) return;
    if (phone() && s.controlsOpen) {
      clear();
      return;
    }
    // Pans sync `view` constantly; only redraw when something this panel shows can have changed.
    const sig = [s.visible.join(), activeYear(s), s.month, ...s.visible.map((id) => (readable(layerById(id)!, s) ? 1 : 0))].join("|");
    if (sig === lastSig) return;
    lastSig = sig;
    ensureReads();
    render();
  });
  root.hidden = true;

  return { inspectAt, clear };
}
