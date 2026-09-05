// Extractor routing (pure): MIME first, extension only as a fallback. R6 / review 16.
import type { DocumentExtractor } from "./types.js";

export function hasExtension(name: string, exts: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

/**
 * The extractor that recognizes the MIME type wins even if the file name says otherwise.
 * Only when no extractor recognizes the MIME (generic or unknown types) does the extension decide.
 */
export function findExtractor(
  extractors: readonly DocumentExtractor[],
  mime: string,
  name: string,
): DocumentExtractor | undefined {
  const byMime = mime.trim() === "" ? undefined : extractors.find((x) => x.supports(mime, ""));
  if (byMime !== undefined) return byMime;
  return extractors.find((x) => x.supports("", name));
}
