// Shared extraction limits (R4 / SEC-03 partial): pre-checks before parsing, and a wall-clock deadline.
import type { ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err } from "../../core/index.js";

export const EXTRACT_TIMEOUT_MS = 60_000;

/** Races extraction against a deadline. The parser keeps running in the background, but the caller is released. */
export async function withDeadline(
  work: Promise<Result<ExtractedDoc, ExtractError>>,
  timeoutMs: number,
): Promise<Result<ExtractedDoc, ExtractError>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Result<ExtractedDoc, ExtractError>>((resolve) => {
    timer = setTimeout(() => {
      resolve(err({ kind: "corrupt", detail: "timeout" }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
