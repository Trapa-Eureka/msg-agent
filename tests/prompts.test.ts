import { describe, expect, it } from "vitest";
import { summaryPrompt, translationPrompt } from "../src/core/prompts.js";

describe("translationPrompt", () => {
  it("names the target language, preserves numbers and proper nouns, and demands translation only", () => {
    const p = translationPrompt("Hello", "ko", "en");
    expect(p.system).toContain("Korean (ko)");
    expect(p.system).toContain("source language is English (en)");
    expect(p.system).toMatch(/preserve all numbers/iu);
    expect(p.system).toMatch(/proper nouns/iu);
    expect(p.system).toMatch(/output only the translation/iu);
    expect(p.system).toMatch(/markdown structure/iu);
    expect(p.user).toBe("Hello");
  });
  it("asks the model to detect the source when no hint is given", () => {
    expect(translationPrompt("x", "ko").system).toContain("Detect the source language yourself");
  });
  it("keeps the user turn as the raw chunk (no template wrapping that could leak into output)", () => {
    const text = "# Title\n\nBody 2,400";
    expect(translationPrompt(text, "ja").user).toBe(text);
  });
});

describe("summaryPrompt", () => {
  it("requests the SPEC §4 structure in the target language and preserves figures", () => {
    const p = summaryPrompt({ text: "doc body", sections: [] }, "ko");
    expect(p.system).toContain("Korean (ko)");
    for (const k of ["Title", "Key points", "Figures", "Action items"])
      expect(p.system).toContain(k);
    expect(p.system).toMatch(/preserve numbers, dates and proper nouns exactly/iu);
    expect(p.system).toMatch(/output only the summary/iu);
    expect(p.user).toBe("doc body");
  });
});
