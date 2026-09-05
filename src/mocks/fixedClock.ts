import type { Clock } from "../core/index.js";

/** Deterministic clock: each `now()` advances by `stepMs`. */
export class FixedClock implements Clock {
  private t: number;
  constructor(
    start = 1_700_000_000_000,
    private readonly stepMs = 10,
  ) {
    this.t = start;
  }
  now(): number {
    const v = this.t;
    this.t += this.stepMs;
    return v;
  }
}
