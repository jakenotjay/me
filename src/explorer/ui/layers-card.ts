import { LAYERS } from "../catalog";
import type { ExplorerState, Store } from "../state";
import type { LayerDef, LayerGroup } from "../types";
import { displayTitle, el } from "./dom";

const GROUPS: Array<{ id: LayerGroup; title: string }> = [
  { id: "forty", title: "Forest typology (ForTy)" },
  { id: "tmf", title: "JRC Tropical Moist Forests" },
  { id: "other", title: "Other Epoch datasets" },
];

const BASEMAPS: Array<{ id: ExplorerState["basemap"]; label: string }> = [
  { id: "satellite", label: "Satellite" },
  { id: "osm", label: "OpenStreetMap" },
  { id: "none", label: "None" },
];

type Row = { def: LayerDef; check: HTMLInputElement; slider: HTMLInputElement; out: HTMLOutputElement; month?: HTMLSelectElement };

/** The right "Map & layers" card. Built once; later state changes only patch values in place. */
export function mountLayersCard(root: HTMLElement, store: Store): void {
  root.replaceChildren();
  const header = el("header");
  const close = el("button", "fold", "Close");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => store.set({ controlsOpen: false }));
  header.append(el("h1", "", "Map & layers"), close);
  const body = el("div", "body");
  root.append(header, body);

  // Basemap
  body.append(el("h2", "", "Basemap"));
  const baseBox = el("div", "basemaps");
  const radios = BASEMAPS.map((b) => {
    const input = el("input");
    input.type = "radio";
    input.name = "basemap";
    input.value = b.id;
    input.addEventListener("change", () => input.checked && store.set({ basemap: b.id }));
    baseBox.append(el("label", "", [input, ` ${b.label}`]));
    return input;
  });
  body.append(baseBox);

  // Layers
  const rows = new Map<string, Row>();
  for (const g of GROUPS) {
    body.append(el("h2", "", g.title));
    for (const def of LAYERS.filter((l) => l.group === g.id)) {
      const { box, row } = buildRow(def, store);
      rows.set(def.id, row);
      body.append(box);
    }
  }

  body.append(
    el(
      "div",
      "credit",
      "Satellite imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community. Map data © OpenStreetMap contributors.",
    ),
  );

  const update = (s: ExplorerState) => {
    root.hidden = !s.controlsOpen;
    for (const r of radios) r.checked = r.value === s.basemap;
    for (const [id, r] of rows) {
      r.check.checked = s.visible.includes(id);
      const op = Math.round((s.opacity[id] ?? r.def.defaultOpacity) * 100);
      if (r.slider.value !== String(op)) r.slider.value = String(op);
      r.out.textContent = `${op}%`;
      if (r.month && r.month.value !== s.month) r.month.value = s.month;
    }
  };
  store.subscribe(update);
  update(store.get());
}

function buildRow(def: LayerDef, store: Store): { box: HTMLElement; row: Row } {
  const box = el("div", "layer");
  const check = el("input");
  check.type = "checkbox";
  check.addEventListener("change", () => {
    const vis = store.get().visible.filter((id) => id !== def.id);
    // Newly shown layers go on top (last in the draw order).
    store.set({ visible: check.checked ? [...vis, def.id] : vis });
  });
  const title = el("span", "ltitle", displayTitle(def.title));
  const label = el("label", "lname", [check, title]);
  if (def.id === "forty-v2") label.append(" ", el("span", "chip", "beta"));
  const info = el("button", "infobtn", "i");
  info.type = "button";
  info.setAttribute("aria-label", `About ${displayTitle(def.title)}`);
  info.setAttribute("aria-expanded", "false");
  const head = el("div", "lhead", [label, info]);

  const body = el("div", "layer-body");
  body.hidden = true;
  info.addEventListener("click", () => {
    body.hidden = !body.hidden;
    info.setAttribute("aria-expanded", String(!body.hidden));
  });

  const slider = el("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.setAttribute("aria-label", `${displayTitle(def.title)} opacity`);
  const out = el("output");
  slider.addEventListener("input", () => {
    store.set({ opacity: { ...store.get().opacity, [def.id]: Number(slider.value) / 100 } });
  });
  body.append(el("div", "ctl", [el("span", "k", "Opacity"), slider, out]));

  let month: HTMLSelectElement | undefined;
  if (def.months?.length) {
    month = el("select");
    month.setAttribute("aria-label", "Month");
    for (const m of def.months) month.append(new Option(m, m));
    month.addEventListener("change", () => store.set({ month: month!.value }));
    body.append(el("div", "ctl", [el("span", "k", "Month"), month]));
  }

  const link = el("a", "", "Dataset page");
  link.href = def.sourceUrl;
  link.target = "_blank";
  link.rel = "noopener";
  body.append(el("div", "note", def.description), el("div", "note", link));

  box.append(head, body);
  return { box, row: { def, check, slider, out, month } };
}
