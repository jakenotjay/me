import { describe, expect, it } from "vitest";
import { createStore, defaultState } from "../state";
import { createPlaybackController, MIN_DWELL_MS, shouldStep, timebarProgress } from "./timebar";

describe("shouldStep", () => {
  it("waits for the full visible-frame dwell", () => {
    expect(shouldStep(MIN_DWELL_MS - 1, true)).toBe(false);
    expect(shouldStep(MIN_DWELL_MS, true)).toBe(true);
  });
  it("never advances an unready frame, even after a long delay", () => {
    expect(shouldStep(60_000, false)).toBe(false);
  });
});

function playbackFixture() {
  const store = createStore({ ...defaultState(), year: 2025 });
  const requests: Partial<ReturnType<typeof defaultState>>[] = [];
  let loaded = true;
  let dwell = 900;
  const playback = createPlaybackController({
    getState: store.get,
    isLoaded: () => loaded,
    requestTime: patch => requests.push(patch),
    getDwell: () => dwell,
  });
  return { store, requests, playback, setLoaded: (v: boolean) => { loaded = v; }, setDwell: (v: number) => { dwell = v; } };
}

describe("prepared-frame playback", () => {
  it("requests once, waits for the date commit, then measures dwell from the visible loaded frame", () => {
    const f = playbackFixture();
    f.playback.start(0);
    f.playback.tick(899);
    expect(f.requests).toEqual([]);
    f.playback.tick(900);
    expect(f.requests).toEqual([{ year: 2017 }]);
    f.playback.tick(20_000);
    expect(f.requests).toHaveLength(1);
    expect(f.store.get().year).toBe(2025);
    f.store.set({ year: 2017 });
    f.setLoaded(false);
    f.playback.observe(21_000);
    f.playback.tick(30_000);
    expect(f.requests).toHaveLength(1);
    f.setLoaded(true);
    f.playback.tick(31_000);
    f.playback.tick(31_899);
    expect(f.requests).toHaveLength(1);
    f.playback.tick(31_900);
    expect(f.requests).toEqual([{ year: 2017 }, { year: 2018 }]);
  });

  it("applies an edited frame interval to playback", () => {
    const f = playbackFixture();
    f.playback.start(0);
    f.setDwell(2500);
    f.playback.tick(900);
    expect(f.requests).toHaveLength(0);
    f.playback.tick(2500);
    expect(f.requests).toEqual([{ year: 2017 }]);
  });

  it("allows manual requests while paused and pauses without canceling a prepared request", () => {
    const f = playbackFixture();
    f.playback.request({ year: 2020 }, 0);
    expect(f.requests).toEqual([{ year: 2020 }]);
    f.playback.start(100);
    f.playback.pause();
    f.store.set({ year: 2020 });
    f.playback.observe(1000);
    f.playback.tick(10_000);
    expect(f.requests).toHaveLength(1);
    expect(f.store.get().year).toBe(2020);
  });
});

const frame = { id: "forty-v2", loaded: 21, total: 21, failed: 0, settled: true };
describe("timeline progress", () => {
  it("reports the preloaded year and source progress after the visible frame is ready", () => {
    const p = timebarProgress([frame], { state: "loading", completed: 2, total: 9, year: 2017, loaded: 3, totalSources: 10 });
    expect(p.label).toBe("Preloading 2017… 3/10 areas · 2/9 years ready");
    expect(p.value).toBeGreaterThan(22);
    expect(p.value).toBeLessThan(33);
  });
  it("retains selected-frame loading and failure information", () => {
    const preload = { state: "ready" as const, completed: 9, total: 9, loaded: 0, totalSources: null };
    expect(timebarProgress([{ ...frame, loaded: 2, settled: false }], preload).label).toBe("Loading 2/21 areas");
    expect(timebarProgress([{ ...frame, failed: 1 }], preload).state).toBe("error");
  });
  it("shows completed years, unknown source counts, and bounded-cache limits", () => {
    expect(timebarProgress([frame], { state: "ready", completed: 9, total: 9, loaded: 0, totalSources: null }).label).toBe("9/9 years ready");
    expect(timebarProgress([frame], { state: "loading", completed: 0, total: 9, year: 2017, loaded: 0, totalSources: null }).label).toContain("finding visible areas");
    expect(timebarProgress([frame], { state: "limited", completed: 4, total: 9, loaded: 0, totalSources: null }).label).toBe("4/9 years ready · Cache limit reached");
  });
});


it("keeps ordinary foreground progress when no annual preload plan exists", () => {
  expect(timebarProgress([frame], { state: "ready", completed: 0, total: 0, loaded: 0, totalSources: null }).label).toBe("Ready");
});

it("uses the requested month label for manually prepared monthly frames", () => {
  expect(timebarProgress([frame], { state: "loading", completed: 0, total: 1, year: 2023, label: "2023-06", loaded: 1, totalSources: 2 }).label).toContain("Preloading 2023-06…");
});


describe("playback cancellation", () => {
  it("starts a fresh play run without remaining blocked by an abandoned date request", () => {
    const f = playbackFixture();
    f.playback.start(0);
    f.playback.tick(900);
    expect(f.requests).toEqual([{ year: 2017 }]);
    f.playback.pause();
    f.playback.start(20_000);
    f.playback.tick(20_900);
    expect(f.requests).toEqual([{ year: 2017 }, { year: 2017 }]);
  });
  it("explicit cancellation clears pending playback and waits for a new play action", () => {
    const f = playbackFixture();
    f.playback.start(0);
    f.playback.tick(900);
    f.playback.cancelRequest();
    f.playback.tick(50_000);
    expect(f.requests).toHaveLength(1);
    f.playback.start(60_000);
    f.playback.tick(60_899);
    expect(f.requests).toHaveLength(1);
    f.playback.tick(60_900);
    expect(f.requests).toHaveLength(2);
  });
});

it("holds actual completed-year progress while discovering the next year's areas", () => {
  const progress = timebarProgress([frame], {
    state: "loading", completed: 3, total: 9, year: 2019, loaded: 0, totalSources: null,
  });
  expect(progress.value).toBe(33);
  expect(progress.state).toBe("loading");
  const halfway = timebarProgress([frame], {
    state: "loading", completed: 3, total: 9, year: 2019, loaded: 10, totalSources: 20,
  });
  expect(halfway.value).toBe(38);
  expect(timebarProgress([frame], {
    state: "loading", completed: 4, total: 9, year: 2020, loaded: 0, totalSources: null,
  }).value).toBe(44);
});

it("keeps real completed-year progress while preloading is paused or has failed", () => {
  const progress = { completed: 3, total: 9, loaded: 0, totalSources: null };
  expect(timebarProgress([frame], { ...progress, state: "waiting" }).value).toBe(33);
  expect(timebarProgress([frame], { ...progress, state: "limited", error: "unavailable" }).value).toBe(33);
});
