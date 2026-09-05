// User-facing phrase contract. The pipeline never contains literal strings; T8 supplies ko/en packs.
// Arguments are metadata only (names, counts, codes) — never document content (guardrail 1).
import type { OutputMode } from "./types.js";

export interface Phrases {
  progressExtracting(fileName: string): string;
  progressTranslating(done: number, total: number): string;
  progressSummarizing(): string;
  /** `langCode` is an ISO 639 code; the pack renders the name in its own language. */
  skipSameLang(langCode: string): string;
  rejectUnsupported(fileName: string, supported: readonly string[]): string;
  rejectTooLarge(sizeBytes: number, maxBytes: number): string;
  rejectOverMax(chars: number, maxChars: number, suggestSummary: boolean): string;
  extractEmpty(fileName: string): string;
  extractEncrypted(fileName: string): string;
  extractCorrupt(fileName: string): string;
  translationFailed(done: number, total: number): string;
  summaryFailed(): string;
  fileCaption(fileName: string, langCode: string): string;
  fileFullNote(fileName: string): string;
  noLastDocument(): string;
  modeChanged(mode: OutputMode): string;
  modeInvalid(arg: string | undefined, modes: readonly OutputMode[]): string;
  langChanged(langCode: string): string;
  langInvalid(arg: string | undefined): string;
  unknownError(): string;
}

export type PhraseKey = keyof Phrases;
