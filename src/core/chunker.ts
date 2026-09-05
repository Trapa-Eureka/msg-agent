// Structure-preserving chunker + reassembly. DESIGN §3 step 5 (R6: original separators are kept).
// Split order: section -> paragraph -> sentence -> grapheme clusters (never inside a character).
import { byGraphemes } from "./textSplit.js";
import type { Chunk, ExtractedDoc, Section, TranslatedChunk } from "./types.js";

export const DEFAULT_CHUNK_CHARS = 4000;
export const CHUNK_SEPARATOR = "\n\n";

/** A piece of text plus the separator that preceded it in the source. */
interface Piece {
  text: string;
  sep: string;
}

/** Splits on `re` (whose capture groups hold the separator), keeping separators attached to the following piece. */
function splitKeeping(text: string, re: RegExp, groups: number): Piece[] {
  const out: Piece[] = [];
  const parts = text.split(re);
  const step = groups + 1;
  let pendingSep = "";
  for (let i = 0; i < parts.length; i += step) {
    const chunk = parts[i] ?? "";
    if (chunk !== "") {
      out.push({ text: chunk, sep: pendingSep });
      pendingSep = "";
    }
    let sep = "";
    for (let g = 1; g <= groups; g++) sep += parts[i + g] ?? "";
    pendingSep += sep;
  }
  return out;
}

const PARAGRAPH_SEP = /(\n[ \t]*\n+)/u;
// Sentence end: terminal punctuation (Latin/CJK/Arabic) followed by whitespace, or a line break. Separators are captured.
const SENTENCE_SEP = /(?<=[.!?؟]["'”’)]?)(\s+)|(?<=[。！？])()|(\n)/u;

/** Greedily packs pieces (joined by their own separators) into strings no longer than `max`; oversize pieces fall through. */
function pack(pieces: Piece[], max: number, fallback: (p: Piece) => Piece[]): Piece[] {
  const out: Piece[] = [];
  let buf: Piece | undefined;
  const flush = (): void => {
    if (buf !== undefined && buf.text !== "") out.push(buf);
    buf = undefined;
  };
  for (const piece of pieces) {
    if (piece.text.length > max) {
      flush();
      out.push(...fallback(piece));
      continue;
    }
    if (buf === undefined) {
      buf = { text: piece.text, sep: piece.sep };
      continue;
    }
    const joined = `${buf.text}${piece.sep}${piece.text}`;
    if (joined.length > max) {
      flush();
      buf = { text: piece.text, sep: piece.sep };
    } else {
      buf.text = joined;
    }
  }
  flush();
  return out;
}

function splitGraphemes(piece: Piece, max: number): Piece[] {
  return byGraphemes(piece.text, max).map((text, i) => ({ text, sep: i === 0 ? piece.sep : "" }));
}

function splitSentences(piece: Piece, max: number): Piece[] {
  const sentences = splitKeeping(piece.text, SENTENCE_SEP, 3).map((p, i) =>
    i === 0 ? { ...p, sep: piece.sep } : p,
  );
  return pack(sentences, max, (s) => splitGraphemes(s, max));
}

function splitParagraphs(text: string, max: number): Piece[] {
  const paragraphs = splitKeeping(text, PARAGRAPH_SEP, 1).filter((p) => p.text.trim() !== "");
  return pack(paragraphs, max, (p) => splitSentences(p, max));
}

/** Section body with its heading restored as Markdown (original level), so every chunk carries its context. */
export function sectionText(section: Section): string {
  if (section.title === undefined) return section.text;
  const hashes = "#".repeat(Math.min(6, Math.max(1, section.level ?? 1)));
  return section.text === ""
    ? `${hashes} ${section.title}`
    : `${hashes} ${section.title}${CHUNK_SEPARATOR}${section.text}`;
}

/**
 * Splits a document into ordered chunks of at most `maxChars` characters each.
 * Sections are never merged across a heading boundary; small sections stay whole.
 * Each chunk records the separator that preceded it within its section so reassembly is lossless.
 */
export function chunkDocument(doc: ExtractedDoc, maxChars: number = DEFAULT_CHUNK_CHARS): Chunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 1)
    throw new RangeError("maxChars must be a positive integer");
  const chunks: Chunk[] = [];
  const sections = doc.sections.length > 0 ? doc.sections : [{ text: doc.text }];
  sections.forEach((section, sectionIndex) => {
    const body = sectionText(section);
    if (body.trim() === "") return;
    splitParagraphs(body, maxChars).forEach((piece, i) => {
      chunks.push({
        index: chunks.length,
        sectionIndex,
        text: piece.text,
        sep: i === 0 ? "" : piece.sep,
      });
    });
  });
  return chunks;
}

/**
 * Reassembles translated chunks in `index` order using the original separators; sections are joined
 * by a blank line. Missing indexes are an error (partial results are never posted).
 */
export function assembleChunks(
  translated: readonly TranslatedChunk[],
  chunks: readonly Chunk[],
): string {
  const byIndex = new Map(translated.map((t) => [t.index, t.text]));
  let out = "";
  chunks.forEach((chunk, i) => {
    const text = byIndex.get(chunk.index);
    if (text === undefined) {
      throw new RangeError(
        `missing translated chunk ${String(chunk.index)} of ${String(chunks.length)}`,
      );
    }
    if (i === 0) {
      out = text;
      return;
    }
    const sameSection = chunks[i - 1]?.sectionIndex === chunk.sectionIndex;
    out += `${sameSection && chunk.sep !== "" ? chunk.sep : CHUNK_SEPARATOR}${text}`;
  });
  return out;
}
