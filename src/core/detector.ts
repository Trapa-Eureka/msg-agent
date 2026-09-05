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
const MIN_LETTERS = 10;
const FULL_CONFIDENCE_LETTERS = 100;
/** Letters needed before the half-sample agreement check is meaningful. */
const MIN_LETTERS_FOR_HALVES = 40;
const AGREEMENT_FACTOR = [0.4, 0.7, 1] as const;
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
    const sample = text.slice(0, SAMPLE_CHARS).replace(NOISE, " ");
    const letters = sample.match(LETTERS)?.length ?? 0;
    if (letters < MIN_LETTERS) return { lang: UNDETERMINED, confidence: 0 };

    const topCode = francAll(sample, FRANC_OPTIONS)[0]?.[0];
    if (topCode === undefined || topCode === UNDETERMINED)
      return { lang: UNDETERMINED, confidence: 0 };
    const lang = canonicalLangCode(topCode)?.code ?? topCode;

    const lengthFactor = clamp01(letters / FULL_CONFIDENCE_LETTERS);
    let agreement = 2;
    if (letters >= MIN_LETTERS_FOR_HALVES) {
      const mid = Math.floor(sample.length / 2);
      agreement = [sample.slice(0, mid), sample.slice(mid)].filter(
        (half) => francAll(half, FRANC_OPTIONS)[0]?.[0] === topCode,
      ).length;
    }
    const confidence = Number((lengthFactor * (AGREEMENT_FACTOR[agreement] ?? 1)).toFixed(3));
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
