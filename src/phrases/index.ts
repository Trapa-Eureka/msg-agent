// Phrase pack registry. T8: add ko, snapshot tests, and fallback rules.
import type { Phrases } from "../core/index.js";
import { en } from "./en.js";

const packs: Readonly<Record<string, Phrases>> = { en };

/** Returns the pack for `lang`, falling back to English. */
export function phrasesFor(lang: string): Phrases {
  return packs[lang.toLowerCase()] ?? en;
}
