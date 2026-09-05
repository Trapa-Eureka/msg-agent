// Output planning policy — SPEC §4 / TESTING §3 golden plans. Pure decision, no content.
import type { OutputMode } from "./types.js";

export type RejectReason =
  /** No extractor for this MIME/extension (SPEC §5 formats). */
  | "unsupported_format"
  /** File larger than the messenger download limit; download was not attempted. */
  | "too_large_bytes"
  /** Extracted text (whitespace included) exceeds `maxChars` (guardrail 5) — ask to split the file, never bypass. */
  | "over_max_chars";

export type PlanDecision =
  | { kind: "inline_full" }
  | { kind: "summary_plus_file" }
  | { kind: "file_full" }
  | { kind: "skip_same_lang" }
  | { kind: "reject"; reason: RejectReason };

export type PlanRequest = "auto" | "full" | "summary";

export interface PlanInput {
  /** Non-whitespace characters of the extracted text. */
  charCount: number;
  /** Whether the document is confidently in the native language (detector). */
  sameLanguage: boolean;
  mode: OutputMode;
  inlineThresholdChars: number;
  maxChars: number;
  /** "full" for `/full`, "summary" for `/summary`, otherwise "auto" (new upload). */
  request?: PlanRequest;
  /** Set to false when no extractor supports the file. */
  supported?: boolean;
  /** Pre-download byte guard; both must be present to apply. */
  sizeBytes?: number;
  maxBytes?: number;
}

export function decidePlan(input: PlanInput): PlanDecision {
  const request = input.request ?? "auto";
  if (input.supported === false) {
    return { kind: "reject", reason: "unsupported_format" };
  }
  if (
    input.sizeBytes !== undefined &&
    input.maxBytes !== undefined &&
    input.sizeBytes > input.maxBytes
  ) {
    return { kind: "reject", reason: "too_large_bytes" };
  }
  if (request === "auto" && input.sameLanguage) return { kind: "skip_same_lang" };
  if (input.charCount > input.maxChars) {
    // Guardrail 5: neither /full nor /summary bypasses the cap (summary needs the whole text too).
    return { kind: "reject", reason: "over_max_chars" };
  }
  if (request === "summary") return { kind: "summary_plus_file" };
  if (request === "full") return { kind: "file_full" };

  const long = input.charCount > input.inlineThresholdChars;
  switch (input.mode) {
    case "summary":
      return { kind: "summary_plus_file" };
    case "full":
      return long ? { kind: "file_full" } : { kind: "inline_full" };
    case "smart":
      return long ? { kind: "summary_plus_file" } : { kind: "inline_full" };
  }
}
