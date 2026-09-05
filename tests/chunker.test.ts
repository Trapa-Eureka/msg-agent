import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHUNK_SEPARATOR,
  assembleChunks,
  chunkDocument,
  sectionText,
} from "../src/core/chunker.js";
import { structureText } from "../src/core/sections.js";
import type { Chunk, ExtractedDoc } from "../src/core/types.js";

const fx = (n: string): string => readFileSync(join("fixtures", "docs", n), "utf8");

/** Every character of the source must survive, in order, ignoring whitespace and heading markers. */
function squash(s: string): string {
  return s.replace(/^#+ /gmu, "").replace(/\s+/gu, "");
}
function hasLoneSurrogate(s: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
}

describe("chunkDocument", () => {
  it("keeps a small document as one chunk per section with headings restored", () => {
    const doc = structureText("# A\n\nfirst.\n\n# B\n\nsecond.");
    const chunks = chunkDocument(doc, 1000);
    expect(chunks.map((c) => c.text)).toEqual(["# A\n\nfirst.", "# B\n\nsecond."]);
    expect(chunks.map((c) => [c.index, c.sectionIndex])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it("packs paragraphs up to the limit and never crosses a section boundary", () => {
    const doc: ExtractedDoc = {
      text: "",
      sections: [
        {
          title: "S1",
          text: ["p1".padEnd(30, "x"), "p2".padEnd(30, "y"), "p3".padEnd(30, "z")].join("\n\n"),
        },
        { title: "S2", text: "tail" },
      ],
    };
    const chunks = chunkDocument(doc, 60);
    expect(chunks.every((c) => c.text.length <= 60)).toBe(true);
    expect(chunks.filter((c) => c.sectionIndex === 0)).toHaveLength(3);
    expect(chunks.at(-1)?.text).toBe("# S2\n\ntail");
  });

  it("falls back to sentence then grapheme splitting for oversize paragraphs", () => {
    const para = "One two. Three four! Five six? " + "seven".repeat(20);
    const chunks = chunkDocument({ text: para, sections: [{ text: para }] }, 40);
    expect(chunks.every((c) => c.text.length <= 40)).toBe(true);
    expect(chunks[0]?.text).toBe("One two. Three four! Five six?");
    expect(squash(chunks.map((c) => c.text).join(""))).toBe(squash(para));
  });

  it("splits CJK and RTL text without breaking characters", () => {
    for (const name of ["ja.txt", "ar-rtl.txt"]) {
      const raw = fx(name);
      const chunks = chunkDocument(structureText(raw), 60);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((c) => c.text.length <= 60)).toBe(true);
      expect(chunks.some((c) => hasLoneSurrogate(c.text))).toBe(false);
      expect(squash(chunks.map((c) => c.text).join("\n"))).toBe(squash(raw));
    }
  });

  it("never splits inside a grapheme cluster (surrogate pairs, combining marks, emoji ZWJ)", () => {
    const text = "𠮷野家 و اللُّغَةُ 👨‍👩‍👧‍👦 é".repeat(12);
    const chunks = chunkDocument({ text, sections: [{ text }] }, 12); // ≥ longest grapheme (ZWJ family = 11)
    const joined = chunks.map((c) => c.text).join("");
    expect(hasLoneSurrogate(joined)).toBe(false);
    expect(chunks.some((c) => hasLoneSurrogate(c.text))).toBe(false);
    expect(chunks.some((c) => c.text.endsWith("‍"))).toBe(false);
    expect(chunks.some((c) => c.text.startsWith("́"))).toBe(false);
    expect(squash(joined)).toBe(squash(text));
  });

  it("never emits a chunk longer than the limit, even for a single oversized grapheme", () => {
    const text = "x" + "\u0301".repeat(4200);
    const chunks = chunkDocument({ text, sections: [{ text }] });
    expect(chunks.every((c) => c.text.length <= 4000)).toBe(true);
    expect(chunks.map((c) => c.text).join("")).toBe(text);
  });

  it("chunks the long English fixture within the default limit in order", () => {
    const doc = structureText(fx("large-en.txt"));
    const chunks = chunkDocument(doc);
    expect(chunks.every((c) => c.text.length <= 4000)).toBe(true);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(chunks.length).toBeGreaterThan(30);
  });

  it("rejects non-positive limits and skips empty sections", () => {
    expect(() => chunkDocument({ text: "x", sections: [] }, 0)).toThrow(RangeError);
    expect(chunkDocument({ text: "", sections: [{ text: "  " }] })).toEqual([]);
  });

  it("renders section text with or without a title", () => {
    expect(sectionText({ text: "b" })).toBe("b");
    expect(sectionText({ title: "T", text: "" })).toBe("# T");
    expect(sectionText({ title: "T", text: "b" })).toBe(`# T${CHUNK_SEPARATOR}b`);
  });
});

describe("assembleChunks", () => {
  const mk = (i: number, sectionIndex: number, sep: string): Chunk => ({
    index: i,
    sectionIndex,
    sep,
    text: "",
  });
  it("joins in index order regardless of arrival order, using original separators inside a section", () => {
    const chunks = [mk(0, 0, ""), mk(1, 0, " "), mk(2, 1, "")];
    const out = assembleChunks(
      [
        { index: 2, text: "c" },
        { index: 0, text: "a" },
        { index: 1, text: "b" },
      ],
      chunks,
    );
    expect(out).toBe("a b\n\nc");
  });
  it("throws on a missing chunk so partial results are never posted", () => {
    expect(() =>
      assembleChunks([{ index: 0, text: "a" }], [mk(0, 0, ""), mk(1, 0, "\n\n")]),
    ).toThrow(/missing translated chunk 1 of 2/);
  });
});

describe("structure preservation (R6, review 09)", () => {
  it("keeps heading levels in chunk text", () => {
    const doc = structureText("## Terms\n\nBody one.\n\n### Payment\n\nPay now.");
    expect(doc.sections.map((s) => [s.title, s.level])).toEqual([
      ["Terms", 2],
      ["Payment", 3],
    ]);
    expect(chunkDocument(doc).map((c) => c.text)).toEqual([
      "## Terms\n\nBody one.",
      "### Payment\n\nPay now.",
    ]);
  });

  it("reassembles a list split across chunks byte-for-byte (original separators, no extra blank lines)", () => {
    const list = "- one\n- two\n- three\n- four";
    const chunks = chunkDocument({ text: list, sections: [{ text: list }] }, 15);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.sep)).toEqual(["", "\n"]);
    const identity = chunks.map((c) => ({ index: c.index, text: c.text }));
    expect(assembleChunks(identity, chunks)).toBe(list);
  });

  it("is lossless for prose split at sentence boundaries and for the fixtures", () => {
    const prose = "First sentence.  Second one!\nThird line? Fourth.";
    const chunks = chunkDocument({ text: prose, sections: [{ text: prose }] }, 20);
    expect(
      assembleChunks(
        chunks.map((c) => ({ index: c.index, text: c.text })),
        chunks,
      ),
    ).toBe(prose);
    for (const name of ["ja.txt", "ar-rtl.txt", "large-en.txt"]) {
      const doc = structureText(fx(name));
      const cs = chunkDocument(doc, 300);
      const rebuilt = assembleChunks(
        cs.map((c) => ({ index: c.index, text: c.text })),
        cs,
      );
      // sections are joined by a blank line; heading markers are restored at their original level
      expect(rebuilt.replace(/\s+/gu, "")).toBe(
        doc.sections
          .map((s) => sectionText(s))
          .join("")
          .replace(/\s+/gu, ""),
      );
    }
  });
});
