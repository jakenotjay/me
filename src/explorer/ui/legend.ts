import { layerById } from "../catalog";
import { yearFor, type ExplorerState, type Store } from "../state";
import type { LayerDef } from "../types";
import { displayTitle, el } from "./dom";

function block(def: LayerDef, s: ExplorerState): HTMLElement {
  const box = el("div", "lblock");
  const head = el("div", "ltitle", displayTitle(def.title));
  const shown = yearFor(def, s.year);
  if (def.id === "surface-water") head.append(" ", el("span", "mono", s.month));
  else if (shown !== undefined) head.append(" ", el("span", "mono", String(shown)));
  box.append(head);

  if (shown !== undefined && shown !== s.year) box.append(el("div", "note", `showing ${shown}`));
  if (s.view.zoom < def.minZoom) {
    box.append(el("div", "note warn", `Zoom in to see this layer (zoom ${def.minZoom}+).`));
  }

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
export function mountLegend(root: HTMLElement, store: Store): void {
  let lastKey = "";
  const update = (s: ExplorerState) => {
    const defs = s.visible.map(layerById).filter((d): d is LayerDef => !!d);
    root.hidden = defs.length === 0;
    // Zoom only matters through each layer's minZoom gate, so key on that, not the raw zoom.
    const key = JSON.stringify([
      defs.map((d) => [d.id, s.view.zoom < d.minZoom, yearFor(d, s.year), d.id === "surface-water" ? s.month : ""]),
      s.year,
    ]);
    if (key === lastKey) return;
    lastKey = key;
    root.replaceChildren(...defs.reverse().map((d) => block(d, s)));
  };
  store.subscribe(update);
  update(store.get());
}
