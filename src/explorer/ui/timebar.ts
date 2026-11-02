import { clampMonth, monthAt, monthIndex, timeAxis, type ExplorerState, type Store, type TimeAxis } from "../state";
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

/** What Play sets next: the following year or month, wrapping to the start from the end (or from outside the range). */
export function nextTime(s: ExplorerState, axis: TimeAxis): Partial<ExplorerState> {
  if (axis.unit === "year") {
    const y = s.year;
    return { year: y >= axis.range[1] || y < axis.range[0] ? axis.range[0] : y + 1 };
  }
  const i = monthIndex(s.month);
  const month = i >= monthIndex(axis.range[1]) || i < monthIndex(axis.range[0]) ? axis.range[0] : monthAt(i + 1);
  return { month, year: Number(month.slice(0, 4)) };
}

/** Slider position (a year, or a month offset from the axis start) and the label shown for the current time. */
export function timeLabel(s: ExplorerState, axis: TimeAxis): { value: number; min: number; max: number; label: string } {
  if (axis.unit === "year") {
    const y = Math.min(Math.max(s.year, axis.range[0]), axis.range[1]);
    return { value: y, min: axis.range[0], max: axis.range[1], label: String(y) };
  }
  const m = clampMonth(s.month, axis.range);
  const start = monthIndex(axis.range[0]);
  return { value: monthIndex(m) - start, min: 0, max: monthIndex(axis.range[1]) - start, label: m };
}

/** Bottom-centre time bar: slider, play/pause (loops) and the current year, or month while a monthly layer is on. */
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
    const axis = timeAxis(store.get());
    if (!axis) return stop();
    store.set(nextTime(store.get(), axis));
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
  slider.addEventListener("input", () => {
    const axis = timeAxis(store.get());
    if (!axis) return;
    if (axis.unit === "year") return store.set({ year: Number(slider.value) });
    const month = monthAt(monthIndex(axis.range[0]) + Number(slider.value));
    store.set({ month, year: Number(month.slice(0, 4)) });
  });

  const update = (s: ExplorerState) => {
    const axis = timeAxis(s);
    root.hidden = !axis;
    document.body.classList.toggle("has-time", !!axis);
    if (!axis) return stop();
    const t = timeLabel(s, axis);
    slider.setAttribute("aria-label", axis.unit === "month" ? "Month" : "Year");
    slider.min = String(t.min);
    slider.max = String(t.max);
    slider.value = String(t.value);
    year.textContent = t.label;
  };
  store.subscribe(update);
  update(store.get());
}
