// DOCX extractor via mammoth. Headings become Markdown headings so the shared structurer sees them.
import mammoth from "mammoth";
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../../core/index.js";
import { err, ok, structureText } from "../../core/index.js";
import { hasExtension } from "./route.js";

const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

export function htmlToBlocks(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/giu, (_m, level: string, inner: string) => {
      return `\n\n${"#".repeat(Number(level))} ${inner.replace(/<[^>]+>/gu, "").trim()}\n\n`;
    })
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<li[^>]*>/giu, "- ")
    .replace(/<\/li>/giu, "\n")
    .replace(/<\/(?:p|tr|div|blockquote|ul|ol)>/giu, "\n\n")
    .replace(/<\/t[dh]>/giu, "\t")
    .replace(/<[^>]+>/gu, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gu, (e) => ENTITIES[e] ?? e);
}

export class DocxExtractor implements DocumentExtractor {
  supports(mime: string, name: string): boolean {
    return mime.toLowerCase() === MIME || hasExtension(name, [".docx"]);
  }

  async extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    let html: string;
    try {
      const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
      html = result.value;
    } catch (e) {
      return err({ kind: "corrupt", detail: e instanceof Error ? e.name : "unknown" });
    }
    const doc = structureText(htmlToBlocks(html));
    if (doc.text === "") return err({ kind: "empty_text" });
    return ok(doc);
  }
}
