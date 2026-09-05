// Messenger length-limit splitting — shared by every adapter and FakeMessenger (DESIGN §4).
// Boundary preference: paragraph -> line -> sentence -> grapheme cluster. Never inside a character.
export const TELEGRAM_MESSAGE_LIMIT = 4096;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const SENTENCE_BOUNDARY = /(?<=[.!?؟]["'”’)]?)\s+|(?<=[。！？])/u;

function packBy(
  text: string,
  limit: number,
  splitter: (t: string) => string[],
  joiner: string,
  fallback: (t: string) => string[],
): string[] {
  const pieces = splitter(text).filter((p) => p !== "");
  const out: string[] = [];
  let buf = "";
  const flush = (): void => {
    if (buf !== "") out.push(buf);
    buf = "";
  };
  for (const piece of pieces) {
    if (piece.length > limit) {
      flush();
      out.push(...fallback(piece));
      continue;
    }
    const joined = buf === "" ? piece : `${buf}${joiner}${piece}`;
    if (joined.length > limit) {
      flush();
      buf = piece;
    } else {
      buf = joined;
    }
  }
  flush();
  return out;
}

/** Last resort for a single grapheme longer than the limit (combining-mark bombs): split by code points. */
export function byCodePoints(text: string, limit: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const cp of text) {
    if (buf.length + cp.length > limit && buf !== "") {
      out.push(buf);
      buf = "";
    }
    buf += cp;
  }
  if (buf !== "") out.push(buf);
  return out;
}

/** Packs grapheme clusters up to `limit`; every returned part is guaranteed to be at most `limit` long. */
export function byGraphemes(text: string, limit: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const { segment } of graphemes.segment(text)) {
    if (segment.length > limit) {
      if (buf !== "") out.push(buf);
      buf = "";
      out.push(...byCodePoints(segment, limit));
      continue;
    }
    if (buf.length + segment.length > limit && buf !== "") {
      out.push(buf);
      buf = "";
    }
    buf += segment;
  }
  if (buf !== "") out.push(buf);
  return out;
}

function bySentences(text: string, limit: number): string[] {
  return packBy(
    text,
    limit,
    (t) => t.split(SENTENCE_BOUNDARY),
    " ",
    (t) => byGraphemes(t, limit),
  );
}

function byLines(text: string, limit: number): string[] {
  return packBy(
    text,
    limit,
    (t) => t.split("\n"),
    "\n",
    (t) => bySentences(t, limit),
  );
}

/**
 * Splits `text` into parts of at most `limit` characters, preferring paragraph boundaries.
 * Returns [] for blank input. Parts are trimmed of surrounding blank lines but keep internal structure.
 */
export function splitForMessenger(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError("limit must be a positive integer");
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (normalized === "") return [];
  return packBy(
    normalized,
    limit,
    (t) => t.split(/\n\s*\n/u),
    "\n\n",
    (t) => byLines(t, limit),
  ).map((p) => p.trim());
}
