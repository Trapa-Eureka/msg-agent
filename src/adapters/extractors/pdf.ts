// Text-layer PDF extractor via pdf-parse (pdf.js). Scanned PDFs (no text layer) -> empty_text.
import { PDFParse, PasswordException, VerbosityLevel } from "pdf-parse";
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, pdfPagesToText, structureText } from "../../core/index.js";
import { hasExtension } from "./route.js";

export class PdfExtractor implements DocumentExtractor {
  supports(mime: string, name: string): boolean {
    return mime.toLowerCase() === "application/pdf" || hasExtension(name, [".pdf"]);
  }

  async extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    const parser = new PDFParse({ data: bytes, verbosity: VerbosityLevel.ERRORS });
    let text: string;
    try {
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
