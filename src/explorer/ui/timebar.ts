import { clampMonth, monthAt, monthLayerRange, monthIndex, timeAxis, type ExplorerState, type Store, type TimeAxis } from "../state";
import type { LayerLoadProgress } from "../raster/layers";
import { el } from "./dom";

export const MIN_DWELL_MS = 900;
const POLL_MS = 100;

/** A frame must be ready and remain visible for the configured dwell before advancing. */
export function shouldStep(elapsedMs: number, loaded: boolean, dwell = MIN_DWELL_MS): boolean {
  return loaded && elapsedMs >= dwell;
}

/** What Play sets next: the following year or month, wrapping to the start from the end (or from outside the range). */
export function nextTime(s: ExplorerState, axis: TimeAxis, mapRange: [string, string] | null = null): Partial<ExplorerState> {
  if (axis.unit === "year") {
    const y = s.year;
    return { year: y >= axis.range[1] || y < axis.range[0] ? axis.range[0] : y + 1 };
  }
  const i = monthIndex(s.month);
  const end = monthIndex(axis.range[1]);
  let next = i + 1;
  if (mapRange) {
    // Outside the monthly layer's own range only the yearly layers change: step a year, landing on the range start.
    if (i < monthIndex(mapRange[0])) next = Math.min(i + 12, monthIndex(mapRange[0]));
    else if (i > monthIndex(mapRange[1])) next = i + 12;
  }
  const month = i >= end || i < monthIndex(axis.range[0]) || next > end ? axis.range[0] : monthAt(next);
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

export type TimelinePreloadProgress = {
  state: "waiting" | "loading" | "ready" | "limited";
  completed: number;
  total: number;
  year?: number;
  label?: string;
  loaded: number;
  totalSources: number | null;
  error?: string;
  cache?: { usedBytes: number; limitBytes: number };
};

export type TimebarOptions = {
  requestTime?: (patch: Partial<ExplorerState>) => void;
  getPreload?: () => TimelinePreloadProgress;
};

/** Keep requested and displayed dates separate while the renderer prepares the next frame. */
export function createPlaybackController(options: {
  getState: () => ExplorerState;
  isLoaded: () => boolean;
  requestTime: (patch: Partial<ExplorerState>) => void;
  getDwell: () => number;
}) {
  const keyOf = (s: ExplorerState) => `${s.year}|${s.month}`;
  let displayed = keyOf(options.getState());
  let awaiting: string | null = null;
  let readySince: number | null = null;
  let playing = false;
  const observe = (now: number) => {
    const key = keyOf(options.getState());
    if (key !== displayed) {
      displayed = key;
      readySince = null;
    }
    if (awaiting === key) awaiting = null;
    if (awaiting || !options.isLoaded()) readySince = null;
    else if (readySince === null) readySince = now;
  };
  const request = (patch: Partial<ExplorerState>, now: number) => {
    const requested = keyOf({ ...options.getState(), ...patch });
    awaiting = requested === displayed ? null : requested;
    readySince = null;
    options.requestTime(patch);
    observe(now);
  };
  return {
    start(now: number) { playing = true; awaiting = null; readySince = null; observe(now); },
    cancelRequest() { playing = false; awaiting = null; readySince = null; },
    pause() { playing = false; },
    observe,
    request,
    tick(now: number) {
      observe(now);
      if (!playing || awaiting || readySince === null || !shouldStep(now - readySince, true, options.getDwell())) return;
      const state = options.getState();
      const axis = timeAxis(state);
      if (!axis) { playing = false; return; }
      request(nextTime(state, axis, monthLayerRange(state)), now);
    },
  };
}

type ProgressDisplay = { label: string; value: number; state: "error" | "ready" | "loading"; busy: boolean };

/** Foreground errors/loading take precedence over background timeline preparation. */
export function timebarProgress(frames: LayerLoadProgress[], preload?: TimelinePreloadProgress): ProgressDisplay {
  const failed = frames.reduce((n, f) => n + f.failed, 0);
  const settled = frames.every((f) => f.settled);
  const total = frames.every((f) => f.total !== null) ? frames.reduce((n, f) => n + (f.total ?? 0), 0) : null;
  const loaded = frames.reduce((n, f) => n + f.loaded, 0);
  let value = frames.length === 0 ? 0 : settled ? 100 : total ? Math.min(99, Math.floor(100 * loaded / total)) : 0;
  let label = frames.length === 0 ? "Zoom in to load this timestep" : failed ? "Some areas failed to load" : settled ? "Ready" : total === null ? "Finding visible areas…" : `Loading ${loaded}/${total} areas`;
  let state: ProgressDisplay["state"] = failed ? "error" : settled ? "ready" : "loading";
  let busy = !settled;
  if (frames.length && settled && !failed && preload && (preload.total > 0 || preload.state === "loading" || preload.error)) {
    const years = `${preload.completed}/${preload.total} years ready`;
    if (preload.error) {
      label = `${years} · Preload failed: ${preload.error}`;
      value = preload.total ? Math.floor(100 * preload.completed / preload.total) : 0;
      state = "error";
    } else if (preload.state === "ready") {
      label = years;
    } else if (preload.state === "limited") {
      const memory = preload.cache;
      label = memory
        ? `${years} · Rendered-frame cache ${Math.round(memory.usedBytes / 1048576)}/${Math.round(memory.limitBytes / 1048576)} MiB`
        : `${years} · Cache limit reached`;
      value = preload.total ? Math.floor(100 * preload.completed / preload.total) : 0;
    } else if (preload.state === "loading") {
      const areas = preload.totalSources === null ? "finding visible areas" : `${preload.loaded}/${preload.totalSources} areas`;
      const target = preload.label ?? preload.year;
      label = `Preloading${target === undefined ? "" : ` ${target}`}… ${areas}${preload.total ? ` · ${years}` : ""}`;
      const fraction = preload.totalSources ? Math.min(1, preload.loaded / preload.totalSources) : 0;
      value = preload.total ? Math.min(99, Math.floor(100 * (preload.completed + fraction) / preload.total)) : Math.min(99, Math.floor(100 * fraction));
      state = "loading";
      busy = true;
    } else {
      label = `${years} · Waiting to preload`;
      value = preload.total ? Math.floor(100 * preload.completed / preload.total) : 0;
    }
  }
  return { label, value, state, busy };
}

/** Bottom-centre time bar: slider, play/pause (loops) and the current year, or month while a monthly layer is on. */
export function mountTimebar(
  root: HTMLElement,
  store: Store,
  isLoaded: () => boolean = () => true,
  getProgress: () => LayerLoadProgress[] = () => [],
  options: TimebarOptions = {},
): { refreshProgress: () => void; cancelPendingRequest: () => void } {
  const play = el("button", "playbtn", "▶");
  play.type = "button";
  play.setAttribute("aria-label", "Play");
  const slider = el("input");
  slider.type = "range";
  slider.setAttribute("aria-label", "Year");
  const year = el("output", "mono yearout");
  const track = el("div", "time-track");
  const progress = el("div", "time-progress");
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", "Timestep loading");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  const fill = el("span", "time-progress-fill");
  const status = el("span", "time-load-status mono");
  progress.append(fill);
  track.append(slider, progress, status);
  const intervalLabel = el("label", "frame-interval mono");
  const interval = el("input");
  interval.type = "number";
  interval.min = "0.1";
  interval.max = "60";
  interval.step = "0.1";
  interval.value = "0.9";
  interval.setAttribute("aria-label", "Frame interval (seconds)");
  intervalLabel.append(el("span", "", "Interval"), interval, el("span", "", "s"));
  root.replaceChildren(play, track, year, intervalLabel);
  let dwellMs = MIN_DWELL_MS;
  const setIntervalValue = () => {
    const n = Number(interval.value);
    if (!Number.isFinite(n) || interval.value === "") return;
    dwellMs = Math.round(1000 * Math.max(0.1, Math.min(60, n)));
  };
  interval.addEventListener("input", setIntervalValue);
  interval.addEventListener("change", () => {
    setIntervalValue();
    interval.value = String(dwellMs / 1000);
  });
  const playback = createPlaybackController({ getState: store.get, isLoaded,
    requestTime: options.requestTime ?? ((patch) => store.set(patch)), getDwell: () => dwellMs });

  let progressKey = "";
  const refreshProgress = () => {
    if (root.hidden) return;
    const { label, value, state, busy } = timebarProgress(getProgress(), options.getPreload?.());
    const key = `${year.textContent}|${value}|${state}|${label}`;
    if (key === progressKey) return;
    progressKey = key;
    progress.dataset.state = state;
    progress.setAttribute("aria-valuetext", `${year.textContent}: ${label}`);
    progress.setAttribute("aria-valuenow", String(value));
    progress.title = `${value}% loaded`;
    fill.style.width = `${value}%`;
    status.textContent = label;
    root.setAttribute("aria-busy", String(busy));
  };
  // Loading callbacks do not mutate the timeline store; sample their counters without rebuilding the map.
  setInterval(refreshProgress, 200);

  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    playback.pause();
    play.textContent = "▶";
    play.setAttribute("aria-label", "Play");
  };
  play.addEventListener("click", () => {
    if (timer !== undefined) return stop();
    play.textContent = "❚❚";
    play.setAttribute("aria-label", "Pause");
    playback.start(Date.now());
    timer = setInterval(() => playback.tick(Date.now()), POLL_MS);
  });
  slider.addEventListener("input", () => {
    const axis = timeAxis(store.get());
    if (!axis) return;
    if (axis.unit === "year") return playback.request({ year: Number(slider.value) }, Date.now());
    const month = monthAt(monthIndex(axis.range[0]) + Number(slider.value));
    playback.request({ month, year: Number(month.slice(0, 4)) }, Date.now());
  });

  const update = (s: ExplorerState) => {
    playback.observe(Date.now());
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
    refreshProgress();
  };
  store.subscribe(update);
  update(store.get());
  return { refreshProgress, cancelPendingRequest: () => { playback.cancelRequest(); stop(); } };
}
