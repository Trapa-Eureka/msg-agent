// Section structuring heuristic shared by every extractor (DESIGN §3 step 2). Pure.
import type { ExtractedDoc, Section } from "./types.js";

const MAX_TITLE_CHARS = 80;
const TERMINAL_PUNCT = /[.!?:;,。．！？：；、]$/u;
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/u;
const ORDERED_LIST = /^(?:\d+[.)]|[-*+•])\s+/u;

export function normalizeText(raw: string): string {
  return raw
    .replace(/\uFEFF/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** A block is a heading when it is a Markdown heading, or a single short line with no terminal punctuation. */
function asTitle(block: string): { title: string; level: number } | undefined {
  const md = MARKDOWN_HEADING.exec(block);
  const hashes = md?.[1];
  const mdTitle = md?.[2];
  if (hashes !== undefined && mdTitle !== undefined)
    return { title: mdTitle.trim(), level: hashes.length };
  if (block.includes("\n")) return undefined;
  if (block.length > MAX_TITLE_CHARS) return undefined;
  if (TERMINAL_PUNCT.test(block)) return undefined;
  if (ORDERED_LIST.test(block)) return undefined;
  if (block.includes("](")) return undefined; // a bare Markdown link is a paragraph, not a heading
  return { title: block, level: 1 };
}

/**
 * Splits normalized text into sections: blank lines separate blocks; heading-like blocks
 * open a new section and become its title; everything else is appended to the current section.
 */
export function structureText(raw: string): ExtractedDoc {
  const text = normalizeText(raw);
  if (text === "") return { text: "", sections: [] };

  const sections: Section[] = [];
  let current: Section | undefined;
  const blocks = text
    .split(/\n\s*\n/u)
    .map((b) => b.trim())
    .filter((b) => b !== "");

  for (const block of blocks) {
    const heading = asTitle(block);
    if (heading !== undefined) {
      current = { title: heading.title, level: heading.level, text: "" };
      sections.push(current);
      continue;
    }
    if (current === undefined) {
      current = { text: "" };
      sections.push(current);
    }
    current.text = current.text === "" ? block : `${current.text}\n\n${block}`;
  }
  return { text, sections };
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const MAX_PDF_HEADING_CHARS = 60;
const SHORT_LAST_LINE_RATIO = 0.7;

function joinWrapped(a: string, b: string): string {
  const tail = a.at(-1) ?? "";
  const head = b.at(0) ?? "";
  // Wrapped CJK text has no spaces; anything else gets one.
  return CJK.test(tail) && CJK.test(head) ? `${a}${b}` : `${a} ${b}`;
}

/**
 * Rebuilds paragraphs and headings from PDF text where every visual line ends with "\n" and
 * paragraph breaks are lost. Emits Markdown-flavoured text ("# Title", blank lines) for structureText:
 * - a short line without terminal punctuation that follows a completed sentence (or a heading) is a heading
 * - a line ending with terminal punctuation that is clearly shorter than the page's longest line ends a paragraph
 * - other lines are wrapped continuations and are joined (no space inserted between CJK characters)
 */
export function pdfPagesToText(pages: readonly string[]): string {
  const out: string[] = [];
  for (const page of pages) {
    const lines = normalizeText(page)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    const maxLen = Math.max(0, ...lines.map((l) => l.length));
    let para = "";
    let prevComplete = true; // start of page, after a heading, or after a terminal-punctuated line
    for (const line of lines) {
      const endsSentence = TERMINAL_PUNCT.test(line);
      const headingLike =
        prevComplete &&
        para === "" &&
        !endsSentence &&
        line.length <= MAX_PDF_HEADING_CHARS &&
        line.length < maxLen * SHORT_LAST_LINE_RATIO && // a wrapped paragraph's first line fills the width
        !ORDERED_LIST.test(line);
      if (headingLike) {
        out.push(`# ${line}`);
        prevComplete = true;
        continue;
      }
      para = para === "" ? line : joinWrapped(para, line);
      const shortLastLine = line.length < maxLen * SHORT_LAST_LINE_RATIO;
      if (endsSentence && shortLastLine) {
        out.push(para);
        para = "";
        prevComplete = true;
      } else {
        prevComplete = false;
      }
    }
    if (para !== "") out.push(para);
  }
  return out.join("\n\n");
}

/** Total non-whitespace characters — used by the size guards. */
export function countChars(text: string): number {
  return text.replace(/\s+/gu, "").length;
}
