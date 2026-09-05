import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DocxExtractor,
  PdfExtractor,
  TextExtractor,
  createExtractors,
  findExtractor,
} from "../src/adapters/extractors/index.js";
import { htmlToBlocks, zipBudget } from "../src/adapters/extractors/docx.js";
import { withDeadline } from "../src/adapters/extractors/limits.js";
import type { ExtractedDoc } from "../src/core/index.js";
import { countChars } from "../src/core/index.js";

const FIXTURES = join(process.cwd(), "fixtures", "docs");
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

async function extractOk(name: string): Promise<ExtractedDoc> {
  const x = findExtractor(createExtractors(), "application/octet-stream", name);
  if (x === undefined) throw new Error(`no extractor for ${name}`);
  const r = await x.extract(fixture(name));
  if (!r.ok) throw new Error(`extract failed: ${r.error.kind}`);
  return r.value;
}

describe("routing", () => {
  const all = createExtractors();
  it("routes by MIME type first", () => {
    expect(findExtractor(all, "application/pdf", "noext")).toBeInstanceOf(PdfExtractor);
    expect(
      findExtractor(
        all,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x",
      ),
    ).toBeInstanceOf(DocxExtractor);
    expect(findExtractor(all, "text/markdown", "x")).toBeInstanceOf(TextExtractor);
  });
  it("falls back to the extension for octet-stream", () => {
    expect(findExtractor(all, "application/octet-stream", "Report.PDF")).toBeInstanceOf(
      PdfExtractor,
    );
    expect(findExtractor(all, "application/octet-stream", "a.docx")).toBeInstanceOf(DocxExtractor);
    expect(findExtractor(all, "application/octet-stream", "notes.md")).toBeInstanceOf(
      TextExtractor,
    );
  });
  it("returns undefined for unsupported formats such as .xlsx", () => {
    expect(findExtractor(all, "application/octet-stream", "sheet.xlsx")).toBeUndefined();
    expect(findExtractor(all, "application/vnd.ms-excel", "sheet")).toBeUndefined();
  });
});

describe("PdfExtractor", () => {
  it("extracts a short English PDF with headings as sections", async () => {
    const doc = await extractOk("en-short.pdf");
    expect(countChars(doc.text)).toBeLessThan(3000);
    expect(doc.text).toContain("USD 2,400");
    expect(doc.sections.map((s) => s.title)).toContain("Fees and Payment");
  });
  it("extracts a long multi-page PDF above the inline threshold", async () => {
    const doc = await extractOk("en-long.pdf");
    expect(countChars(doc.text)).toBeGreaterThan(3000);
    expect(doc.text).toContain("Section 14. Delivery Milestones");
  });
  it("extracts Korean text intact", async () => {
    const doc = await extractOk("ko.pdf");
    expect(doc.text).toContain("서비스 이용 약관");
    expect(doc.text).toContain("월 1.5%");
  });
  it("can extract the same bytes twice (buffer is not detached by pdf.js)", async () => {
    const bytes = fixture("en-short.pdf");
    const x = new PdfExtractor();
    const first = await x.extract(bytes);
    const second = await x.extract(bytes);
    expect(first.ok && second.ok).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
  it("returns empty_text for a PDF without a text layer", async () => {
    const r = await new PdfExtractor().extract(fixture("scanned.pdf"));
    expect(r).toEqual({ ok: false, error: { kind: "empty_text" } });
  });
  it("returns encrypted for a password-protected PDF without crashing", async () => {
    const r = await new PdfExtractor().extract(fixture("encrypted.pdf"));
    expect(r).toEqual({ ok: false, error: { kind: "encrypted" } });
  });
  it("returns corrupt for non-PDF bytes and never echoes content", async () => {
    const r = await new PdfExtractor().extract(new TextEncoder().encode("SECRET-BODY not a pdf"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("corrupt");
    expect(JSON.stringify(r.error)).not.toContain("SECRET-BODY");
  });
});

describe("DocxExtractor", () => {
  it("extracts Spanish DOCX with headings and list items", async () => {
    const doc = await extractOk("es.docx");
    expect(doc.sections.map((s) => s.title)).toEqual([
      "Contrato de Servicios",
      "Honorarios y pago",
      "Entregables",
    ]);
    expect(doc.sections[2]?.text).toContain("Módulo de facturación");
    expect(doc.text).toContain("USD 2.400");
  });
  it("returns corrupt for non-DOCX bytes", async () => {
    const r = await new DocxExtractor().extract(new TextEncoder().encode("not a zip"));
    expect(!r.ok && r.error.kind).toBe("corrupt");
  });
  it("converts HTML blocks to Markdown-ish text and decodes entities", () => {
    expect(htmlToBlocks("<h2>A &amp; B</h2><p>x<br/>y</p><ul><li>i</li><li>j</li></ul>")).toBe(
      "\n\n## A & B\n\nx\ny\n\n- i\n- j\n\n\n",
    );
  });
});

describe("extraction limits (R4 / SEC-03 partial)", () => {
  it("refuses DOCX archives over the entry budget before parsing", async () => {
    const r = await new DocxExtractor({ maxEntries: 1 }).extract(fixture("es.docx"));
    expect(r).toEqual({ ok: false, error: { kind: "corrupt", detail: "zip_budget" } });
    const budget = await zipBudget(fixture("es.docx"));
    expect(budget.entries).toBeGreaterThan(1);
    expect(budget.uncompressed).toBeGreaterThan(budget.entries);
  });
  it("refuses PDFs with more pages than allowed before extracting text", async () => {
    const r = await new PdfExtractor({ maxPages: 1 }).extract(fixture("en-long.pdf"));
    expect(r).toEqual({ ok: false, error: { kind: "corrupt", detail: "too_many_pages" } });
    expect((await new PdfExtractor({ maxPages: 1 }).extract(fixture("en-short.pdf"))).ok).toBe(
      true,
    );
  });
  it("releases the caller when extraction exceeds the deadline", async () => {
    const never = new Promise<never>(() => undefined);
    const r = await withDeadline(never, 5);
    expect(r).toEqual({ ok: false, error: { kind: "corrupt", detail: "timeout" } });
  });
});

describe("TextExtractor", () => {
  it("extracts Japanese TXT with Markdown headings", async () => {
    const doc = await extractOk("ja.txt");
    expect(doc.sections.map((s) => s.title)).toEqual(["業務委託契約書", "報酬および支払い"]);
  });
  it("extracts Arabic RTL TXT byte-for-byte", async () => {
    const doc = await extractOk("ar-rtl.txt");
    expect(doc.text.startsWith("اتفاقية الخدمات")).toBe(true);
    expect(doc.sections).toHaveLength(2);
  });
  it("extracts Markdown", async () => {
    const doc = await extractOk("en-short.md");
    expect(doc.sections[0]?.title).toBe("Release Notes");
    expect(doc.sections[1]?.text).toContain("1. Back up the database.");
  });
  it("reads the large fixture above maxChars", async () => {
    const doc = await extractOk("large-en.txt");
    expect(countChars(doc.text)).toBeGreaterThan(120_000);
  });
  it("returns empty_text for blank input and corrupt for invalid UTF-8", async () => {
    const x = new TextExtractor();
    expect(await x.extract(new TextEncoder().encode(" \n\t"))).toEqual({
      ok: false,
      error: { kind: "empty_text" },
    });
    expect(await x.extract(new Uint8Array([0xff, 0xfe, 0xc0]))).toEqual({
      ok: false,
      error: { kind: "corrupt", detail: "invalid UTF-8" },
    });
  });
});
