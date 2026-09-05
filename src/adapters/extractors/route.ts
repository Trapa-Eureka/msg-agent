import type { DocumentExtractor } from "../../core/index.js";

export function hasExtension(name: string, exts: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

/** Picks the first extractor whose `supports` accepts the MIME type or file name. */
export function findExtractor(
  extractors: readonly DocumentExtractor[],
  mime: string,
  name: string,
): DocumentExtractor | undefined {
  return extractors.find((x) => x.supports(mime, name));
}
