import type { DocumentExtractor } from "../../core/index.js";
import { DocxExtractor } from "./docx.js";
import { PdfExtractor } from "./pdf.js";
import { TextExtractor } from "./text.js";

export { DocxExtractor, PdfExtractor, TextExtractor };
export { findExtractor, hasExtension } from "./route.js";

/** v0.1 extractor set: text-layer PDF, DOCX, UTF-8 TXT/MD (SPEC §5). */
export function createExtractors(): DocumentExtractor[] {
  return [new PdfExtractor(), new DocxExtractor(), new TextExtractor()];
}
