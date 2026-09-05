import { describe, expect, it } from "vitest";
import { decidePlan, needsFullTranslation, needsSummary } from "../src/core/outputPlanner.js";
import type { PlanInput } from "../src/core/outputPlanner.js";

const base: PlanInput = {
  charCount: 2000,
  sameLanguage: false,
  mode: "smart",
  inlineThresholdChars: 3000,
  maxChars: 120_000,
};

describe("golden plans (TESTING §3, 7 cases)", () => {
  it("1. 2,000 chars + smart -> inline_full", () => {
    expect(decidePlan(base)).toEqual({ kind: "inline_full" });
  });
  it("2. 30,000 chars + smart -> summary_plus_file", () => {
    expect(decidePlan({ ...base, charCount: 30_000 })).toEqual({ kind: "summary_plus_file" });
  });
  it("3. 2,000 chars + mode=summary -> summary_plus_file", () => {
    expect(decidePlan({ ...base, mode: "summary" })).toEqual({ kind: "summary_plus_file" });
  });
  it("4. 30,000 chars + mode=full (within max) -> file_full", () => {
    expect(decidePlan({ ...base, charCount: 30_000, mode: "full" })).toEqual({ kind: "file_full" });
  });
  it("5. detected native language -> skip_same_lang", () => {
    expect(decidePlan({ ...base, sameLanguage: true })).toEqual({ kind: "skip_same_lang" });
  });
  it("6. over maxChars -> reject with summary suggestion", () => {
    expect(decidePlan({ ...base, charCount: 120_001 })).toEqual({
      kind: "reject",
      reason: "over_max_chars",
      suggestSummary: true,
    });
  });
  it("7. unsupported format (.xlsx) -> reject", () => {
    expect(decidePlan({ ...base, supported: false })).toEqual({
      kind: "reject",
      reason: "unsupported_format",
      suggestSummary: false,
    });
  });
});

describe("edge policy", () => {
  it("full mode below the threshold stays inline", () => {
    expect(decidePlan({ ...base, mode: "full" })).toEqual({ kind: "inline_full" });
  });
  it("threshold is inclusive: exactly inlineThresholdChars is short", () => {
    expect(decidePlan({ ...base, charCount: 3000 })).toEqual({ kind: "inline_full" });
    expect(decidePlan({ ...base, charCount: 3001 })).toEqual({ kind: "summary_plus_file" });
  });
  it("rejects files over the byte limit before anything else", () => {
    expect(decidePlan({ ...base, sizeBytes: 21e6, maxBytes: 20e6, sameLanguage: true })).toEqual({
      kind: "reject",
      reason: "too_large_bytes",
      suggestSummary: false,
    });
  });
  it("/full re-runs as file_full and still respects maxChars (guardrail 5)", () => {
    expect(decidePlan({ ...base, request: "full" })).toEqual({ kind: "file_full" });
    expect(decidePlan({ ...base, request: "full", sameLanguage: true })).toEqual({
      kind: "file_full",
    });
    expect(decidePlan({ ...base, request: "full", charCount: 200_000 })).toEqual({
      kind: "reject",
      reason: "over_max_chars",
      suggestSummary: true,
    });
  });
  it("/summary yields summary_plus_file and does not suggest summary when already over max", () => {
    expect(decidePlan({ ...base, request: "summary" })).toEqual({ kind: "summary_plus_file" });
    expect(decidePlan({ ...base, request: "summary", charCount: 200_000 })).toEqual({
      kind: "reject",
      reason: "over_max_chars",
      suggestSummary: false,
    });
  });
  it("classifies which plans need translation and summary calls", () => {
    expect(needsFullTranslation("inline_full")).toBe(true);
    expect(needsFullTranslation("file_full")).toBe(true);
    expect(needsFullTranslation("skip_same_lang")).toBe(false);
    expect(needsSummary("summary_plus_file")).toBe(true);
    expect(needsSummary("file_full")).toBe(false);
  });
});
