import { describe, expect, it } from "vitest";
import { countChars, normalizeText, pdfPagesToText, structureText } from "../src/core/sections.js";

describe("structureText", () => {
  it("returns no sections for whitespace-only input", () => {
    expect(structureText("  \n\n \t")).toEqual({ text: "", sections: [] });
  });

  it("uses Markdown headings as section titles", () => {
    const doc = structureText("# Title\n\nFirst paragraph.\n\n## Sub\n\nSecond.\n\nThird.");
    expect(doc.sections).toEqual([
      { title: "Title", level: 1, text: "First paragraph." },
      { title: "Sub", level: 2, text: "Second.\n\nThird." },
    ]);
  });

  it("treats a short single line without terminal punctuation as a heading", () => {
    const doc = structureText("Fees and Payment\n\nThe Client agrees to pay.\n\nA short sentence.");
    expect(doc.sections[0]?.title).toBe("Fees and Payment");
    expect(doc.sections[0]?.text).toBe("The Client agrees to pay.\n\nA short sentence.");
  });

  it("does not treat list items or long lines as headings", () => {
    const long = "x".repeat(81);
    const doc = structureText(`1. Back up the database.\n\n- item\n\n${long}`);
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.title).toBeUndefined();
  });

  it("keeps body text before any heading in an untitled section", () => {
    const doc = structureText("Intro sentence.\n\nHeading\n\nBody.");
    expect(doc.sections.map((s) => s.title)).toEqual([undefined, "Heading"]);
  });

  it("handles CJK terminal punctuation and RTL text without altering characters", () => {
    const ja = "業務委託契約書\n\n本契約は効力を生じます。";
    const ar = "اتفاقية الخدمات\n\nتصف هذه الاتفاقية الخدمات.";
    expect(structureText(ja).sections).toEqual([
      { title: "業務委託契約書", level: 1, text: "本契約は効力を生じます。" },
    ]);
    expect(structureText(ar).sections[0]?.title).toBe("اتفاقية الخدمات");
    expect(structureText(ar).text).toBe(ar);
  });

  it("normalizes CRLF, BOM, trailing spaces, and excess blank lines", () => {
    expect(normalizeText("\uFEFFa  \r\n\r\n\r\n\r\nb\r\n")).toBe("a\n\nb");
  });

  it("counts non-whitespace characters", () => {
    expect(countChars(" a b\n c ")).toBe(3);
  });
});

describe("pdfPagesToText", () => {
  it("recovers headings and paragraphs from line-wrapped page text", () => {
    const page = [
      "Service Agreement Overview",
      "This agreement describes the services provided by the Vendor to the Client, the fees",
      "payable, and the responsibilities of both parties.",
      "The Vendor will deliver the modules listed in Appendix A and provide support during",
      "business hours.",
      "Fees and Payment",
      "The Client agrees to pay a monthly fee of USD 2,400.",
    ].join("\n");
    const doc = structureText(pdfPagesToText([page]));
    expect(doc.sections.map((s) => s.title)).toEqual([
      "Service Agreement Overview",
      "Fees and Payment",
    ]);
    expect(doc.sections[0]?.text.split("\n\n")).toHaveLength(2);
    expect(doc.sections[0]?.text).toContain("the fees payable, and");
  });

  it("joins wrapped CJK lines without inserting spaces, but keeps spaces before non-CJK", () => {
    const page = [
      "요금 및 결제",
      "본 약관은 회사가 제공하는 서비스의 이용 조건과 절차, 회사와 이용자의 권리와 의무를 규정합",
      "니다. 이용자는 청구서에 따라 30일 이내에 요금을 납부해야 합니다. 연체 시 월",
      "1.5%의 이자가 부과됩니다.",
    ].join("\n");
    const text = pdfPagesToText([page]);
    expect(text).toContain("규정합니다.");
    expect(text).toContain("월 1.5%");
    expect(text.startsWith("# 요금 및 결제")).toBe(true);
  });

  it("does not turn a short wrapped continuation into a heading", () => {
    const page =
      "A long first line that keeps going and going without any punctuation at its end\nshort tail\nNext Heading\nBody text ends here.";
    const text = pdfPagesToText([page]);
    expect(text).not.toContain("# short tail");
  });
});
