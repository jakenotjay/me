import { LAYERS } from "../catalog";
import { timeRange, type ExplorerState, type Store } from "../state";
import { el } from "./dom";

const STEP_MS = 900;

/** Bottom-centre time bar: year slider, play/pause (loops) and the current year. */
export function mountTimebar(root: HTMLElement, store: Store): void {
  const play = el("button", "playbtn", "▶");
  play.type = "button";
  play.setAttribute("aria-label", "Play");
  const slider = el("input");
  slider.type = "range";
  slider.setAttribute("aria-label", "Year");
  const year = el("output", "mono yearout");
  root.replaceChildren(play, slider, year);

  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    play.textContent = "▶";
    play.setAttribute("aria-label", "Play");
  };
  const step = () => {
    const r = timeRange(store.get(), LAYERS);
    if (!r) return stop();
    const y = store.get().year;
    store.set({ year: y >= r[1] || y < r[0] ? r[0] : y + 1 });
  };
  play.addEventListener("click", () => {
    if (timer !== undefined) return stop();
    play.textContent = "❚❚";
    play.setAttribute("aria-label", "Pause");
    step();
    timer = setInterval(step, STEP_MS);
  });
  slider.addEventListener("input", () => store.set({ year: Number(slider.value) }));

  const update = (s: ExplorerState) => {
    const r = timeRange(s, LAYERS);
    root.hidden = !r;
    document.body.classList.toggle("has-time", !!r);
    if (!r) return stop();
    slider.min = String(r[0]);
    slider.max = String(r[1]);
    const y = Math.min(Math.max(s.year, r[0]), r[1]);
    slider.value = String(y);
    year.textContent = String(y);
  };
  store.subscribe(update);
  update(store.get());
}
