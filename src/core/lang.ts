// Language code helpers — pure, data-only (iso-639-3 table, no IO).
import { iso6393 } from "iso-639-3";

export interface LanguageInfo {
  /** Canonical code: ISO 639-1 (2 letters) when one exists, otherwise ISO 639-3 (3 letters). */
  code: string;
  /** English reference name from the ISO table. */
  name: string;
  iso6393: string;
  iso6391?: string;
}

const byCode = new Map<string, LanguageInfo>();
for (const entry of iso6393) {
  const info: LanguageInfo = {
    code: entry.iso6391 ?? entry.iso6393,
    name: entry.name,
    iso6393: entry.iso6393,
    ...(entry.iso6391 === undefined ? {} : { iso6391: entry.iso6391 }),
  };
  byCode.set(entry.iso6393, info);
  if (entry.iso6391 !== undefined) byCode.set(entry.iso6391, info);
}

/**
 * ISO 639-3 individual languages that detectors (franc) emit for what users name by the
 * macrolanguage's 639-1 code. Maps member -> canonical code of the macrolanguage.
 */
const MACROLANGUAGE_MEMBER: Readonly<Record<string, string>> = {
  arb: "ar", // Standard Arabic
  cmn: "zh", // Mandarin
  pes: "fa", // Iranian Persian
  prs: "fa", // Dari
  zsm: "ms", // Standard Malay
  nob: "nb", // Bokmål (has its own 639-1)
  swh: "sw", // Swahili
  uzn: "uz",
  azj: "az",
  ekk: "et",
  lvs: "lv",
  khk: "mn",
  plt: "mg",
  als: "sq",
  quy: "qu",
  gug: "gn",
  ydd: "yi",
  pnb: "pa",
};

/**
 * Normalizes user input ("KO", "kor", "ko") to a canonical language code.
 * Returns undefined for anything that is not an ISO 639-1/639-3 code.
 * Language *names* ("Korean") are resolved by the onboarding autocomplete (T7), not here.
 */
export function canonicalLangCode(input: string): LanguageInfo | undefined {
  const key = input.trim().toLowerCase();
  if (!/^[a-z]{2,3}$/.test(key)) return undefined;
  const macro = MACROLANGUAGE_MEMBER[key];
  return byCode.get(macro ?? key);
}

export function isLangCode(input: string): boolean {
  return canonicalLangCode(input) !== undefined;
}
