import { layerById } from "../catalog";
import { yearFor, type ExplorerState, type Store } from "../state";
import type { LayerDef } from "../types";
import { displayTitle, el } from "./dom";

/** "showing YYYY" when the selected year is outside the layer's years and its nearest one is used. */
export function showingNote(def: LayerDef, year: number): string | undefined {
  const shown = yearFor(def, year);
  return shown !== undefined && shown !== year ? `showing ${shown}` : undefined;
}

export const FAILED_NOTE = "Some tiles failed to load — pan or zoom to retry.";

function block(def: LayerDef, s: ExplorerState, failed: boolean): HTMLElement {
  const box = el("div", "lblock");
  const head = el("div", "ltitle", displayTitle(def.title));
  const shown = yearFor(def, s.year);
  if (def.id === "surface-water") head.append(" ", el("span", "mono", s.month));
  else if (shown !== undefined) head.append(" ", el("span", "mono", String(shown)));
  box.append(head);

  const showing = showingNote(def, s.year);
  if (showing) box.append(el("div", "note", showing));
  if (s.view.zoom < def.minZoom) {
    box.append(el("div", "note warn", `Zoom in to see this layer (zoom ${def.minZoom}+).`));
  }

  if (failed) box.append(el("div", "note warn", FAILED_NOTE));

  const lg = def.legend;
  if (lg.kind === "classes") {
    const list = el("div", "lclasses");
    for (const c of lg.classes) {
      const sq = el("i", "sq");
      sq.style.background = c.color;
      list.append(el("div", "lclass", [sq, c.label]));
    }
    box.append(list);
  } else {
    const fill = el("i");
    fill.style.background = `linear-gradient(to right, ${lg.colors.join(", ")})`;
    box.append(el("div", "ramp", fill), el("div", "ends", [el("span", "mono", lg.minLabel), el("span", "mono", lg.maxLabel)]));
  }
  if (lg.note) box.append(el("div", "note", lg.note));
  return box;
}

/** Bottom-right legend: one block per visible layer, top layer first. Rebuilds only when its inputs change. */
export function mountLegend(
  root: HTMLElement,
  store: Store,
  failed: (layerId: string) => boolean = () => false,
): { refresh: () => void } {
  let lastKey = "";
  const update = (s: ExplorerState) => {
    const defs = s.visible.map(layerById).filter((d): d is LayerDef => !!d);
    root.hidden = defs.length === 0;
    // Zoom only matters through each layer's minZoom gate, so key on that, not the raw zoom.
    const key = JSON.stringify([
      defs.map((d) => [d.id, s.view.zoom < d.minZoom, yearFor(d, s.year), d.id === "surface-water" ? s.month : ""]),
      s.year,
      defs.map((d) => failed(d.id)),
    ]);
    if (key === lastKey) return;
    lastKey = key;
    root.replaceChildren(...defs.reverse().map((d) => block(d, s, failed(d.id))));
  };
  store.subscribe(update);
  update(store.get());
  return { refresh: () => update(store.get()) };
}
