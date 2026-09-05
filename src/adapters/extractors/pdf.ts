// Text-layer PDF extractor via pdf-parse (pdf.js). Scanned PDFs (no text layer) -> empty_text.
import { PDFParse, PasswordException, VerbosityLevel } from "pdf-parse";
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, pdfPagesToText, structureText } from "../../core/index.js";
import { EXTRACT_TIMEOUT_MS, withDeadline } from "./limits.js";
import { hasExtension } from "./route.js";

export const PDF_MAX_PAGES = 500;

export interface PdfExtractorOptions {
  maxPages?: number;
  timeoutMs?: number;
}

export class PdfExtractor implements DocumentExtractor {
  private readonly maxPages: number;
  private readonly timeoutMs: number;
  constructor(opts: PdfExtractorOptions = {}) {
    this.maxPages = opts.maxPages ?? PDF_MAX_PAGES;
    this.timeoutMs = opts.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  }

  supports(mime: string, name: string): boolean {
    return mime.toLowerCase() === "application/pdf" || hasExtension(name, [".pdf"]);
  }

  extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    return withDeadline(this.parse(bytes), this.timeoutMs);
  }

  private async parse(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    // pdf.js transfers (detaches) the buffer it is given; hand it a copy so callers can reuse `bytes`.
    const parser = new PDFParse({ data: bytes.slice(), verbosity: VerbosityLevel.ERRORS });
    let text: string;
    try {
      const info = await parser.getInfo();
      if (info.total > this.maxPages) return err({ kind: "corrupt", detail: "too_many_pages" });
      const result = await parser.getText();
      text = pdfPagesToText(result.pages.map((p) => p.text));
    } catch (e) {
      if (e instanceof PasswordException) return err({ kind: "encrypted" });
      return err({ kind: "corrupt", detail: e instanceof Error ? e.name : "unknown" });
    } finally {
      await parser.destroy();
    }
    const doc = structureText(text);
    if (doc.text === "") return err({ kind: "empty_text" });
    return ok(doc);
  }
}
