// Structure-preserving chunker + reassembly. DESIGN §3 step 5.
// Split order: section -> paragraph -> sentence -> grapheme clusters (never inside a character).
import { byGraphemes } from "./textSplit.js";
import type { Chunk, ExtractedDoc, Section, TranslatedChunk } from "./types.js";

export const DEFAULT_CHUNK_CHARS = 4000;
export const CHUNK_SEPARATOR = "\n\n";

const PARAGRAPH = /\n\s*\n/u;
// Sentence end: terminal punctuation (Latin/CJK/Arabic) followed by whitespace, or a line break.
const SENTENCE_BOUNDARY = /(?<=[.!?؟]["'”’)]?)\s+|(?<=[。！？])|(?<=\n)/u;

const splitGraphemes = (text: string, max: number): string[] => byGraphemes(text, max);

/** Greedily packs `pieces` (joined by `sep`) into strings no longer than `max`; oversize pieces fall through to `fallback`. */
function pack(
  pieces: string[],
  sep: string,
  max: number,
  fallback: (p: string) => string[],
): string[] {
  const out: string[] = [];
  let buf = "";
  const flush = (): void => {
    if (buf !== "") out.push(buf);
    buf = "";
  };
  for (const piece of pieces) {
    if (piece.length > max) {
      flush();
      out.push(...fallback(piece));
      continue;
    }
    const joined = buf === "" ? piece : `${buf}${sep}${piece}`;
    if (joined.length > max) {
      flush();
      buf = piece;
    } else {
      buf = joined;
    }
  }
  flush();
  return out;
}

function splitSentences(text: string, max: number): string[] {
  const sentences = text.split(SENTENCE_BOUNDARY).filter((s) => s !== "");
  return pack(sentences, " ", max, (s) => splitGraphemes(s, max));
}

function splitParagraphs(text: string, max: number): string[] {
  const paragraphs = text.split(PARAGRAPH).filter((p) => p.trim() !== "");
  return pack(paragraphs, CHUNK_SEPARATOR, max, (p) => splitSentences(p, max));
}

/** Section body with its heading restored as Markdown, so every chunk carries its context. */
export function sectionText(section: Section): string {
  if (section.title === undefined) return section.text;
  return section.text === ""
    ? `# ${section.title}`
    : `# ${section.title}${CHUNK_SEPARATOR}${section.text}`;
}

/**
 * Splits a document into ordered chunks of at most `maxChars` characters each.
 * Sections are never merged across a heading boundary; small sections stay whole.
 */
export function chunkDocument(doc: ExtractedDoc, maxChars: number = DEFAULT_CHUNK_CHARS): Chunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 1)
    throw new RangeError("maxChars must be a positive integer");
  const chunks: Chunk[] = [];
  const sections = doc.sections.length > 0 ? doc.sections : [{ text: doc.text }];
  sections.forEach((section, sectionIndex) => {
    const body = sectionText(section);
    if (body.trim() === "") return;
    for (const text of splitParagraphs(body, maxChars)) {
      chunks.push({ index: chunks.length, sectionIndex, text });
    }
  });
  return chunks;
}

/** Reassembles translated chunks in `index` order. Missing indexes are an error (partial results are never posted). */
export function assembleChunks(translated: readonly TranslatedChunk[], expected: number): string {
  const byIndex = new Map(translated.map((t) => [t.index, t.text]));
  const parts: string[] = [];
  for (let i = 0; i < expected; i++) {
    const text = byIndex.get(i);
    if (text === undefined)
      throw new RangeError(`missing translated chunk ${String(i)} of ${String(expected)}`);
    parts.push(text);
  }
  return parts.join(CHUNK_SEPARATOR);
}
