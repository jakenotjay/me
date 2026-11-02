import { LAYERS } from "../catalog";
import { timeRange, type ExplorerState, type Store } from "../state";
import { el } from "./dom";

export const MIN_DWELL_MS = 900;
export const MAX_WAIT_MS = 8000;
const POLL_MS = 100;

/**
 * Play steps once the frame has been shown for the minimum dwell AND its layers have loaded,
 * or unconditionally after the max wait so a failed tile cannot stall play.
 */
export function shouldStep(elapsedMs: number, loaded: boolean, dwell = MIN_DWELL_MS, maxWait = MAX_WAIT_MS): boolean {
  if (elapsedMs >= maxWait) return true;
  return loaded && elapsedMs >= dwell;
}

/** Bottom-centre time bar: year slider, play/pause (loops) and the current year. */
export function mountTimebar(root: HTMLElement, store: Store, isLoaded: () => boolean = () => true): void {
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
  let steppedAt = 0;
  const step = () => {
    steppedAt = Date.now();
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
    timer = setInterval(() => {
      if (shouldStep(Date.now() - steppedAt, isLoaded())) step();
    }, POLL_MS);
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
