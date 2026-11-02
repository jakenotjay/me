import type { ExplorerState, Store } from "../state";
import { el } from "./dom";

/** Top-right buttons: Inspect toggle, Layers, About. `about` is the About card element. */
export function mountTopbtns(root: HTMLElement, store: Store, about: HTMLElement): void {
  const mk = (text: string, label: string) => {
    const b = el("button", "", text);
    b.type = "button";
    b.setAttribute("aria-label", label);
    return b;
  };
  const inspect = mk("Inspect", "Inspect a point");
  const layers = mk("Layers", "Map and layers");
  const aboutBtn = mk("About", "About this page");
  root.replaceChildren(inspect, layers, aboutBtn);

  inspect.addEventListener("click", () => store.set({ inspect: !store.get().inspect }));
  const phone = () => window.matchMedia("(max-width: 600px)").matches;
  const setAbout = (open: boolean) => {
    about.hidden = !open;
    aboutBtn.setAttribute("aria-expanded", String(open));
  };
  // On a phone both cards are bottom sheets, so only one can be open.
  layers.addEventListener("click", () => {
    const open = !store.get().controlsOpen;
    if (open && phone()) setAbout(false);
    store.set({ controlsOpen: open });
  });
  aboutBtn.addEventListener("click", () => {
    const open = about.hidden;
    if (open && phone() && store.get().controlsOpen) store.set({ controlsOpen: false });
    setAbout(open);
  });

  const update = (s: ExplorerState) => {
    inspect.classList.toggle("on", s.inspect);
    inspect.setAttribute("aria-pressed", String(s.inspect));
    layers.setAttribute("aria-expanded", String(s.controlsOpen));
    layers.classList.toggle("open", s.controlsOpen);
  };
  store.subscribe(update);
  update(store.get());
}
