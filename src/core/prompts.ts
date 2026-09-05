// Prompt templates — the only place prompt wording lives (DESIGN §5). Pure.
import { canonicalLangCode } from "./lang.js";
import type { ExtractedDoc } from "./types.js";

function langLabel(code: string): string {
  const info = canonicalLangCode(code);
  return info === undefined ? code : `${info.name} (${info.code})`;
}

export interface TranslatePrompt {
  system: string;
  user: string;
}

/** Per-chunk translation prompt. The reply must be the translation only. */
export function translationPrompt(
  chunkText: string,
  to: string,
  sourceLangHint?: string,
): TranslatePrompt {
  const source =
    sourceLangHint === undefined
      ? "Detect the source language yourself."
      : `The source language is ${langLabel(sourceLangHint)}.`;
  const system = [
    `You are a professional document translator. Translate the user's text into ${langLabel(to)}.`,
    source,
    "Rules:",
    "- Preserve all numbers, dates, amounts, currencies, units, percentages, codes, identifiers, URLs and email addresses exactly as written.",
    "- Keep proper nouns (people, companies, products, places) in their original form; add a transliteration in parentheses only when the target language conventionally does so.",
    "- Keep the Markdown structure exactly: headings (#), lists, tables, emphasis and line breaks stay where they are.",
    "- Translate every sentence; do not summarize, omit, or add anything.",
    "- If the text is already in the target language, return it unchanged.",
    "- Output only the translation. No preamble, no notes, no quotes, no code fences.",
  ].join("\n");
  return { system, user: chunkText };
}

/** Structured summary prompt (SPEC §4): title, key clauses, figures, requests — in the target language. */
export function summaryPrompt(doc: ExtractedDoc, to: string): TranslatePrompt {
  const system = [
    `You summarize documents for a busy reader. Write the summary in ${langLabel(to)}.`,
    "Format (Markdown, in this order, omit a section only if the document has nothing for it):",
    "1. **제목/Title** — the document's title or a one-line description of what it is.",
    "2. **핵심 내용/Key points** — 3 to 7 bullets covering the main clauses, decisions, or findings.",
    "3. **수치/Figures** — every important number: amounts, dates, deadlines, quantities, percentages. Preserve them exactly as written.",
    "4. **요청/Action items** — what the reader is asked to do, decide, or reply to, with deadlines.",
    "Rules:",
    "- Preserve numbers, dates and proper nouns exactly; do not convert currencies or units.",
    "- Be faithful: no speculation, no advice beyond what the document says.",
    "- Keep it under 250 words. Output only the summary. No preamble.",
  ].join("\n");
  return { system, user: doc.text };
}
