// Phrase pack registry with fallback: exact code -> English.
import type { Phrases } from "../core/index.js";
import { canonicalLangCode } from "../core/index.js";
import { en } from "./en.js";
import { ko } from "./ko.js";

export const PHRASE_PACKS: Readonly<Record<string, Phrases>> = { en, ko };
export const FALLBACK_PHRASE_LANG = "en";

/** Returns the pack for `lang` (any ISO 639 spelling, e.g. "kor"), falling back to English. */
export function phrasesFor(lang: string): Phrases {
  const code = canonicalLangCode(lang)?.code ?? lang.trim().toLowerCase();
  return PHRASE_PACKS[code] ?? en;
}

export function hasPhrasePack(lang: string): boolean {
  const code = canonicalLangCode(lang)?.code ?? lang.trim().toLowerCase();
  return code in PHRASE_PACKS;
}

export { en, ko };
