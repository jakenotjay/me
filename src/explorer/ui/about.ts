import { LAYERS } from "../catalog";
import { el } from "./dom";

const PRODUCT_NAMES: Record<string, string> = {
  "forest-typology-2020": "Forest typology (ForTy)",
  "jrc-tmf": "JRC Tropical Moist Forests",
  "global-forest-loss-drivers": "Global forest loss drivers",
  "global-natural-planted-forests": "Global natural and planted forests",
  "jrc-global-forest-cover-2020": "JRC global forest cover 2020",
  "jrc-global-forest-types-2020": "JRC global forest types 2020",
  "jrc-global-surface-water-monthly": "JRC monthly surface water",
};

function link(href: string, text: string): HTMLAnchorElement {
  const a = el("a", "", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

/** The About card: what this page is, product links, beta note and credit. */
export function mountAbout(root: HTMLElement): void {
  const header = el("header");
  const close = el("button", "fold", "Close");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => {
    root.hidden = true;
    document.querySelector('#topbtns [aria-label="About this page"]')?.setAttribute("aria-expanded", "false");
  });
  header.append(el("h1", "", "About this explorer"), close);

  const body = el("div", "body");
  body.append(
    el(
      "p",
      "",
      "A map of Epoch's open forest datasets, mirrored on Source Cooperative. The browser reads them directly as cloud-optimised GeoTIFFs; there is no server behind this page.",
    ),
    el(
      "p",
      "note",
      "ForTy v2 (2017–2025) is beta: expect rough edges and changes before it is final.",
    ),
    el("h2", "", "Products"),
  );
  const seen = new Set<string>();
  const list = el("ul", "plain");
  for (const def of LAYERS) {
    if (seen.has(def.sourceUrl)) continue;
    seen.add(def.sourceUrl);
    const slug = def.sourceUrl.split("/").slice(-2, -1)[0];
    list.append(el("li", "", link(def.sourceUrl, PRODUCT_NAMES[slug] ?? slug)));
  }
  body.append(list);
  body.append(
    el("div", "credit", ["Built with ", link("https://github.com/developmentseed/deck.gl-raster", "deck.gl-raster"), "."]),
  );
  root.replaceChildren(header, body);
}
