import { describe, expect, it } from "vitest";
import { defaultState, type ExplorerState } from "../state";
import { TimelinePreloader } from "./preloader";

const frame = (year: number): ExplorerState => ({ ...defaultState(), year });
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function harness() {
  const prepared = new Set<number>([2025]);
  const committed: number[] = [];
  const jobs: { year: number; signal: AbortSignal; progress: (loaded: number, total: number | null) => void; resolve: () => void; reject: (error: Error) => void }[] = [];
  const loader = new TimelinePreloader({
    isPrepared: (state) => prepared.has(state.year),
    prepare: (state, signal, progress) => new Promise<void>((resolve, reject) => {
      jobs.push({ year: state.year, signal, progress, resolve: () => { prepared.add(state.year); resolve(); }, reject });
    }),
    commit: (state) => { committed.push(state.year); },
  });
  const frames = [2017, 2018, 2019, 2025].map(frame);
  const update = (ready = true, key = "view") => loader.update({ key, state: frame(2025), frames, ready });
  return { loader, jobs, prepared, committed, update };
}

describe("TimelinePreloader", () => {
  it("waits for the foreground, then prepares ascending frames without switching the displayed date", async () => {
    const h = harness();
    h.update(false);
    expect(h.jobs).toHaveLength(0);
    expect(h.loader.getProgress().state).toBe("waiting");
    h.update(); h.update();
    expect(h.jobs.map((j) => j.year)).toEqual([2017]);
    h.jobs[0].progress(3, 10);
    expect(h.loader.getProgress()).toMatchObject({ state: "loading", year: 2017, loaded: 3, totalSources: 10, completed: 1, total: 4 });
    for (let i = 0; i < 3; i++) { h.jobs[i].resolve(); await tick(); }
    expect(h.jobs.map((j) => j.year)).toEqual([2017, 2018, 2019]);
    expect(h.committed).toEqual([]);
    expect(h.loader.getProgress()).toMatchObject({ state: "ready", completed: 4 });
  });

  it("keeps a manual selection queued before the first viewport plan arrives", async () => {
    const h = harness();
    h.loader.request(frame(2019));
    h.update(false);
    expect(h.jobs[0].signal.aborted).toBe(false);
    h.jobs[0].resolve();
    await tick();
    expect(h.committed).toEqual([2019]);
  });

  it("prioritizes manual requests and commits only their completed preparation", async () => {
    const h = harness(); h.update();
    h.loader.request(frame(2019));
    expect(h.jobs[0].signal.aborted).toBe(true);
    expect(h.jobs.map((j) => j.year)).toEqual([2017, 2019]);
    expect(h.committed).toEqual([]);
    h.jobs[0].resolve(); await tick();
    expect(h.committed).toEqual([]);
    h.jobs[1].resolve(); await tick();
    expect(h.committed).toEqual([2019]);
    h.loader.request(frame(2025));
    expect(h.committed).toEqual([2019, 2025]);
    h.loader.cancel();
  });

  it("suspends background work until the foreground becomes ready again", () => {
    const h = harness(); h.update(); h.update(false);
    expect(h.jobs[0].signal.aborted).toBe(true);
    expect(h.loader.getProgress().state).toBe("waiting");
    h.update();
    expect(h.jobs.map((j) => j.year)).toEqual([2017, 2017]);
    h.loader.cancel();
  });

  it("suppresses canceled and old-context manual resolutions", async () => {
    const h = harness(); h.update(false);
    h.loader.request(frame(2018)); h.loader.cancel();
    h.jobs[0].resolve(); await tick();
    expect(h.committed).toEqual([]);
    h.update(false); h.loader.request(frame(2019)); h.update(false, "new-view");
    expect(h.jobs[1].signal.aborted).toBe(true);
    h.jobs[1].resolve(); await tick();
    expect(h.committed).toEqual([]);
    h.update();
    expect(h.jobs.at(-1)?.year).toBe(2017);
    h.loader.cancel();
  });

  it("stops after real memory eviction without reloading evicted frames in a loop", async () => {
    const h = harness();
    h.update(); h.jobs[0].resolve(); await tick();
    expect(h.jobs.map((j) => j.year)).toEqual([2017, 2018]);
    h.prepared.delete(2017); // Simulate the byte-budget LRU evicting a prepared frame.
    h.jobs[1].resolve(); await tick();
    expect(h.loader.getProgress()).toMatchObject({ state: "limited", completed: 2, total: 4 });
    h.update(); h.update();
    expect(h.jobs).toHaveLength(2);
    h.loader.request(frame(2017)); // Explicit user requests still take priority.
    h.jobs[2].resolve(); await tick();
    expect(h.committed).toEqual([2017]);
  });

  it("keeps a manual failure visible instead of silently retrying it behind background work", async () => {
    const h = harness();
    h.update();
    h.loader.request(frame(2019));
    h.jobs.at(-1)!.reject(new Error("manual failed"));
    await tick();
    expect(h.loader.getProgress()).toMatchObject({ state: "limited", error: "manual failed" });
    const count = h.jobs.length;
    h.update(); h.update();
    expect(h.jobs).toHaveLength(count);
    h.loader.request(frame(2018));
    h.jobs.at(-1)!.resolve(); await tick();
    expect(h.committed).toEqual([2018]);
  });

  it("continues after a failed background year and keeps the current date after manual failure", async () => {
    const h = harness(); h.update(); h.jobs[0].reject(new Error("unavailable")); await tick();
    expect(h.jobs.at(-1)?.year).toBe(2018);
    expect(h.loader.getProgress().error).toContain("unavailable");
    h.loader.request(frame(2019)); h.jobs.at(-1)!.reject(new Error("manual failed")); await tick();
    expect(h.committed).toEqual([]);
    expect(h.loader.getProgress().error).toContain("manual failed");
    h.loader.cancel();
  });
});

it("preloads the complete 36-year TMF timeline when all frames fit in memory", async () => {
  const prepared = new Set([2025]);
  const years: number[] = [];
  const loader = new TimelinePreloader({
    isPrepared: (state) => prepared.has(state.year),
    prepare: async (state) => { years.push(state.year); prepared.add(state.year); },
    commit: () => { throw new Error("Background preparation must not change the displayed year"); },
  });
  loader.update({ key: "tmf-view", state: frame(2025), frames: Array.from({ length: 36 }, (_, i) => frame(1990 + i)), ready: true });
  for (let i = 0; i < 36; i++) await tick();
  expect(years).toEqual(Array.from({ length: 35 }, (_, i) => 1990 + i));
  expect(loader.getProgress()).toMatchObject({ state: "ready", completed: 36, total: 36 });
});
