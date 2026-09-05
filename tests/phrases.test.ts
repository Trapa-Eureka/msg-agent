import { describe, expect, it } from "vitest";
import type { PhraseKey, Phrases } from "../src/core/index.js";
import {
  FALLBACK_PHRASE_LANG,
  PHRASE_PACKS,
  en,
  hasPhrasePack,
  ko,
  phrasesFor,
} from "../src/phrases/index.js";
import { languageName } from "../src/phrases/names.js";

/** One fixed invocation per key, so the snapshot covers the whole contract. */
const CALLS: Record<PhraseKey, (p: Phrases) => string> = {
  progressExtracting: (p) => p.progressExtracting("contract.pdf"),
  progressTranslating: (p) => p.progressTranslating(3, 7),
  progressSummarizing: (p) => p.progressSummarizing(),
  skipSameLang: (p) => p.skipSameLang("ko"),
  rejectUnsupported: (p) => p.rejectUnsupported("sheet.xlsx", ["pdf", "docx", "txt", "md"]),
  rejectTooLarge: (p) => p.rejectTooLarge(25 * 1024 * 1024, 20 * 1024 * 1024),
  rejectOverMax: (p) => p.rejectOverMax(150000, 120000),
  extractEmpty: (p) => p.extractEmpty("scan.pdf"),
  extractEncrypted: (p) => p.extractEncrypted("locked.pdf"),
  extractCorrupt: (p) => p.extractCorrupt("bad.docx"),
  translationFailed: (p) => p.translationFailed(2, 7),
  summaryFailed: (p) => p.summaryFailed(),
  fileCaption: (p) => p.fileCaption("contract.ko.md", "ko"),
  fileFullNote: (p) => p.fileFullNote("contract.pdf"),
  noLastDocument: (p) => p.noLastDocument(),
  modeChanged: (p) => p.modeChanged("summary"),
  modeInvalid: (p) => p.modeInvalid("loud", ["smart", "full", "summary"]),
  langChanged: (p) => p.langChanged("ja"),
  langInvalid: (p) => p.langInvalid("Klingon"),
  unknownError: (p) => p.unknownError(),
  paired: (p) => p.paired(),
  chatAllowed: (p) => p.chatAllowed(),
  chatDenied: (p) => p.chatDenied(),
  rateLimited: (p) => p.rateLimited(20),
  dailyBudgetExhausted: (p) => p.dailyBudgetExhausted(),
};
const KEYS = Object.keys(CALLS) as PhraseKey[];

function render(p: Phrases): Record<string, string> {
  return Object.fromEntries(KEYS.map((k) => [k, CALLS[k](p)]));
}

describe("phrase packs", () => {
  it("ko renders every key (snapshot)", () => {
    expect(render(ko)).toMatchSnapshot();
  });

  it("en renders every key (snapshot)", () => {
    expect(render(en)).toMatchSnapshot();
  });

  it("every pack returns a non-empty string for every key and embeds the arguments", () => {
    for (const [lang, pack] of Object.entries(PHRASE_PACKS)) {
      const r = render(pack);
      for (const k of KEYS) expect(r[k]?.trim().length, `${lang}.${k}`).toBeGreaterThan(0);
      expect(r.progressExtracting).toContain("contract.pdf");
      expect(r.progressTranslating).toContain("3/7");
      expect(r.rejectUnsupported).toContain("pdf, docx, txt, md");
      expect(r.rejectTooLarge).toContain("20.0 MB");
      expect(r.rejectOverMax).toContain("150000");
      expect(r.translationFailed).toContain("2/7");
      expect(r.modeInvalid).toContain("smart, full, summary");
      expect(r.langInvalid).toContain("Klingon");
      expect(pack.modeInvalid(undefined, ["smart"])).not.toContain("undefined");
      expect(pack.langInvalid(undefined)).not.toContain("undefined");
    }
  });

  it("renders language names in the pack's own language", () => {
    expect(ko.skipSameLang("ko")).toContain("한국어");
    expect(ko.langChanged("ja")).toContain("일본어");
    expect(ko.fileCaption("x.md", "fil")).toContain("필리핀어");
    expect(en.skipSameLang("ko")).toContain("Korean");
    expect(en.langChanged("fil")).toContain("Filipino");
    expect(languageName("zzz", "ko")).toBe("zzz");
  });

  it("phrasesFor resolves any ISO spelling and falls back to English", () => {
    expect(phrasesFor("ko")).toBe(ko);
    expect(phrasesFor("kor")).toBe(ko);
    expect(phrasesFor("KO")).toBe(ko);
    expect(phrasesFor("en")).toBe(en);
    expect(phrasesFor("ja")).toBe(en);
    expect(phrasesFor("fil")).toBe(en);
    expect(phrasesFor("nonsense")).toBe(en);
    expect(hasPhrasePack("kor")).toBe(true);
    expect(hasPhrasePack("ja")).toBe(false);
    expect(FALLBACK_PHRASE_LANG).toBe("en");
  });

  it("packs contain no document-content placeholders (metadata only)", () => {
    for (const pack of Object.values(PHRASE_PACKS)) {
      for (const k of KEYS) expect(CALLS[k](pack)).not.toMatch(/\{\{|\$\{/u);
    }
  });
});
