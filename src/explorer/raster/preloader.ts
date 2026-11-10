import { timeAxis, type ExplorerState } from "../state";

export type PreloadProgress = {
  state: "waiting" | "loading" | "ready" | "limited";
  completed: number;
  total: number;
  year?: number;
  manual?: boolean;
  label?: string;
  loaded: number;
  totalSources: number | null;
  error?: string;
};
export type PreloaderCallbacks = {
  isPrepared(state: ExplorerState): boolean;
  prepare(state: ExplorerState, signal: AbortSignal, onProgress: (loaded: number, totalSources: number | null) => void, manual: boolean): Promise<void>;
  commit(state: ExplorerState): void;
};
export type PreloadPlan = { key: string; state: ExplorerState; frames: ExplorerState[]; ready: boolean };

type Job = { state: ExplorerState; manual: boolean; controller: AbortController; loaded: number; totalSources: number | null };
const frameId = (state: ExplorerState) => `${state.year}|${state.month}`;

/** Serial background preparation, with manual selection taking priority over the warm-up plan. */
export class TimelinePreloader {
  private plan?: PreloadPlan;
  private job?: Job;
  // Remember attempts, including failures, so cache eviction cannot create a perpetual preload loop.
  private attempted = new Set<string>();
  private error?: string;
  private failedManual = false;
  private capacityReached = false;
  private resident = new Set<string>();

  constructor(private readonly callbacks: PreloaderCallbacks) {}

  update(plan: PreloadPlan): void {
    if (this.plan && this.plan.key !== plan.key) {
      this.abort();
      this.attempted.clear();
      this.resident.clear();
      this.capacityReached = false;
      this.error = undefined;
      this.failedManual = false;
    }
    this.plan = plan;
    this.attempted.add(frameId(plan.state));
    if (!plan.ready && !this.job?.manual) this.abort();
    this.pump();
  }

  request(state: ExplorerState): void {
    if (this.job?.manual && frameId(this.job.state) === frameId(state)) return;
    this.abort();
    this.error = undefined;
    this.failedManual = false;
    if (this.callbacks.isPrepared(state)) {
      this.callbacks.commit(state);
      this.pump();
    } else {
      this.start(state, true);
    }
  }

  /** Stop this run; a later ready update may start another one. */
  cancel(): void {
    this.abort();
    if (this.plan) this.plan = { ...this.plan, ready: false };
    this.error = undefined;
    this.failedManual = false;
  }

  getProgress(): PreloadProgress {
    const frames = this.plan?.frames ?? [];
    const completed = frames.filter((state) => this.callbacks.isPrepared(state)).length;
    const state = this.job ? "loading" : !this.plan?.ready ? "waiting" : completed === frames.length ? "ready" : "limited";
    return {
      state,
      completed,
      total: frames.length,
      ...(this.job ? { manual: this.job.manual, year: this.job.state.year, label: timeAxis(this.job.state)?.unit === "month" ? this.job.state.month : String(this.job.state.year) } : {}),
      loaded: this.job?.loaded ?? 0,
      totalSources: this.job?.totalSources ?? null,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  private abort(): void {
    const job = this.job;
    if (!job) return;
    this.job = undefined;
    this.attempted.delete(frameId(job.state));
    job.controller.abort();
  }

  private pump(): void {
    if (this.failedManual || !this.plan?.ready || this.job) return;
    const resident = new Set(this.plan.frames.filter((state) => this.callbacks.isPrepared(state)).map(frameId));
    // Stop only after real cache eviction, rather than imposing a frame count.
    // Remembering attempts also prevents an eviction/reload loop in the same view.
    if ([...this.resident].some((id) => !resident.has(id))) this.capacityReached = true;
    this.resident = resident;
    if (this.capacityReached) return;
    const next = this.plan.frames.find((state) => !this.attempted.has(frameId(state)) && !this.callbacks.isPrepared(state));
    if (next) this.start(next, false);
  }

  private start(state: ExplorerState, manual: boolean): void {
    const job: Job = { state, manual, controller: new AbortController(), loaded: 0, totalSources: null };
    this.job = job;
    this.attempted.add(frameId(state));
    void this.run(job);
  }

  private async run(job: Job): Promise<void> {
    try {
      await this.callbacks.prepare(job.state, job.controller.signal, (loaded, totalSources) => {
        if (this.job !== job || job.controller.signal.aborted) return;
        job.loaded = loaded;
        job.totalSources = totalSources;
      }, job.manual);
      if (this.job !== job || job.controller.signal.aborted) return;
      if (!this.callbacks.isPrepared(job.state)) throw new Error("Frame preparation finished without a prepared frame");
      this.job = undefined;
      if (job.manual) this.callbacks.commit(job.state);
    } catch (error) {
      if (this.job !== job || job.controller.signal.aborted) return;
      this.job = undefined;
      this.error = error instanceof Error ? error.message : String(error);
      this.failedManual = job.manual;
    }
    this.pump();
  }
}
