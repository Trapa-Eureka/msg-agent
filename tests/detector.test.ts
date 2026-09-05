import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DETECT_CONFIDENCE_THRESHOLD,
  FrancDetector,
  isConfidentlySameLanguage,
  sampleRegions,
  sourceLangHint,
} from "../src/core/detector.js";

const fx = (n: string): string => readFileSync(join("fixtures", "docs", n), "utf8");
const d = new FrancDetector();

describe("FrancDetector", () => {
  it("detects fixture languages with canonical codes and high confidence", () => {
    expect(d.detect(fx("ja.txt"))).toMatchObject({ lang: "ja" });
    expect(d.detect(fx("ar-rtl.txt"))).toMatchObject({ lang: "ar" });
    expect(d.detect(fx("large-en.txt"))).toMatchObject({ lang: "en" });
    for (const n of ["ja.txt", "ar-rtl.txt", "large-en.txt"]) {
      expect(d.detect(fx(n)).confidence).toBeGreaterThanOrEqual(DETECT_CONFIDENCE_THRESHOLD);
    }
  });

  it("detects Korean and Spanish prose", () => {
    const ko =
      "본 약관은 회사가 제공하는 서비스의 이용 조건과 절차, 회사와 이용자의 권리와 의무를 규정합니다. 이용자는 매월 청구서에 따라 요금을 납부해야 합니다.";
    const es =
      "Este contrato describe los servicios que el Proveedor prestará al Cliente, los honorarios pagaderos y las responsabilidades de ambas partes. Entra en vigor el primero de octubre.";
    expect(d.detect(ko).lang).toBe("ko");
    expect(d.detect(es).lang).toBe("es");
  });

  it("returns und with zero confidence for numbers-only or tiny input", () => {
    expect(d.detect("2026-10-01 12:00 USD 2,400 30%")).toEqual({ lang: "und", confidence: 0 });
    expect(d.detect("Hi")).toEqual({ lang: "und", confidence: 0 });
    expect(d.detect("")).toEqual({ lang: "und", confidence: 0 });
  });

  it("gives low confidence to short mixed-language snippets", () => {
    const r = d.detect("Invoice 청구서 Payment 결제 Total 합계 Due 만기");
    expect(r.confidence).toBeLessThan(DETECT_CONFIDENCE_THRESHOLD);
  });

  it("is deterministic", () => {
    const t = fx("en-short.md");
    expect(d.detect(t)).toEqual(d.detect(t));
  });
});

describe("mixed-language documents (R6, review 10)", () => {
  it("does not trust a document whose head is English but whose body is Korean", () => {
    const mixed =
      "The vendor delivers the modules on time and invoices monthly. ".repeat(24) +
      "공급자는 모듈을 기한 내에 납품하고 매월 청구서를 발행합니다. ".repeat(200);
    const r = d.detect(mixed);
    expect(r.confidence).toBeLessThan(DETECT_CONFIDENCE_THRESHOLD);
    expect(isConfidentlySameLanguage(r, "en")).toBe(false);
    expect(isConfidentlySameLanguage(r, "ko")).toBe(false);
    expect(sampleRegions(mixed)).toHaveLength(3);
  });
  it("still trusts long uniform documents", () => {
    expect(d.detect(fx("large-en.txt")).confidence).toBeGreaterThanOrEqual(
      DETECT_CONFIDENCE_THRESHOLD,
    );
  });
});

describe("same-language and hint helpers", () => {
  it("matches only trusted detections, across 639-1/639-3 spellings", () => {
    expect(isConfidentlySameLanguage({ lang: "ko", confidence: 0.9 }, "kor")).toBe(true);
    expect(isConfidentlySameLanguage({ lang: "ko", confidence: 0.5 }, "ko")).toBe(false);
    expect(isConfidentlySameLanguage({ lang: "und", confidence: 0 }, "ko")).toBe(false);
    expect(isConfidentlySameLanguage({ lang: "en", confidence: 0.9 }, "ko")).toBe(false);
  });
  it("omits the source hint when unsure", () => {
    expect(sourceLangHint({ lang: "en", confidence: 0.95 })).toBe("en");
    expect(sourceLangHint({ lang: "en", confidence: 0.2 })).toBeUndefined();
    expect(sourceLangHint({ lang: "und", confidence: 0 })).toBeUndefined();
  });
});
