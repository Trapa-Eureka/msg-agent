// Language detection — franc (deterministic trigram model, no IO). DESIGN §3 step 3.
// Confidence blends sample size with agreement between the two halves of the sample (franc's
// score gap converges toward zero on long text, so it is not used). Below the threshold the
// pipeline skips the same-language shortcut and lets the translation prompt detect the source.
import { francAll } from "franc";
import { canonicalLangCode } from "./lang.js";
import type { LanguageDetection, LanguageDetector } from "./types.js";

export const UNDETERMINED = "und";
/** Detections at or above this confidence are trusted for the same-language skip and the source hint. */
export const DETECT_CONFIDENCE_THRESHOLD = 0.7;

const SAMPLE_CHARS = 2000;
const REGION_CHARS = 700;

/** Head, middle and tail regions for long text; a single head sample for short text (R6). */
export function sampleRegions(text: string): string[] {
  if (text.length <= SAMPLE_CHARS) return [text];
  if (text.length < REGION_CHARS * 3) return [text.slice(0, SAMPLE_CHARS)];
  const mid = Math.floor(text.length / 2 - REGION_CHARS / 2);
  return [
    text.slice(0, REGION_CHARS),
    text.slice(mid, mid + REGION_CHARS),
    text.slice(-REGION_CHARS),
  ];
}
const MIN_LETTERS = 10;
const FULL_CONFIDENCE_LETTERS = 100;
/** Letters needed before the half-sample agreement check is meaningful. */
const MIN_LETTERS_FOR_HALVES = 40;
/** Near-duplicate trigram profiles that shadow common languages. */
const IGNORED_CODES = ["sco"];
const FRANC_OPTIONS = { minLength: MIN_LETTERS, ignore: IGNORED_CODES };
const NOISE = /[\p{N}\p{P}\p{S}]+|https?:\S+/gu;
const LETTERS = /\p{L}/gu;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export class FrancDetector implements LanguageDetector {
  detect(text: string): LanguageDetection {
    const samples = sampleRegions(text).map((r) => r.replace(NOISE, " "));
    const combined = samples.join(" ");
    const letters = combined.match(LETTERS)?.length ?? 0;
    if (letters < MIN_LETTERS) return { lang: UNDETERMINED, confidence: 0 };

    const topCode = francAll(combined, FRANC_OPTIONS)[0]?.[0];
    if (topCode === undefined || topCode === UNDETERMINED)
      return { lang: UNDETERMINED, confidence: 0 };
    const lang = canonicalLangCode(topCode)?.code ?? topCode;

    const lengthFactor = clamp01(letters / FULL_CONFIDENCE_LETTERS);
    // Agreement across regions: a document whose head is in one language and body in another must not be skipped.
    let regions = samples;
    if (regions.length === 1 && letters >= MIN_LETTERS_FOR_HALVES) {
      const only = regions[0] ?? "";
      const mid = Math.floor(only.length / 2);
      regions = [only.slice(0, mid), only.slice(mid)];
    }
    const agreeing = regions.filter((r) => francAll(r, FRANC_OPTIONS)[0]?.[0] === topCode).length;
    const disagreeing = regions.length - agreeing;
    const agreementFactor =
      regions.length === 1 ? 1 : disagreeing === 0 ? 1 : disagreeing === 1 ? 0.6 : 0.4;
    const confidence = Number((lengthFactor * agreementFactor).toFixed(3));
    return { lang, confidence };
  }
}

/** True only when the detection is trusted and matches the native language. */
export function isConfidentlySameLanguage(
  detection: LanguageDetection,
  nativeLang: string,
  threshold: number = DETECT_CONFIDENCE_THRESHOLD,
): boolean {
  if (detection.lang === UNDETERMINED || detection.confidence < threshold) return false;
  const a = canonicalLangCode(detection.lang)?.code ?? detection.lang;
  const b = canonicalLangCode(nativeLang)?.code ?? nativeLang;
  return a === b;
}

/** Source-language hint for the translator, or undefined when the detection is not trusted. */
export function sourceLangHint(
  detection: LanguageDetection,
  threshold: number = DETECT_CONFIDENCE_THRESHOLD,
): string | undefined {
  if (detection.lang === UNDETERMINED || detection.confidence < threshold) return undefined;
  return detection.lang;
}
