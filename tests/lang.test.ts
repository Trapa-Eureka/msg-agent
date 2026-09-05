import { describe, expect, it } from "vitest";
import { canonicalLangCode, isLangCode } from "../src/core/lang.js";

describe("canonicalLangCode", () => {
  it("accepts ISO 639-1 codes case-insensitively and trims", () => {
    expect(canonicalLangCode(" KO ")?.code).toBe("ko");
    expect(canonicalLangCode("en")?.name).toBe("English");
  });
  it("maps ISO 639-3 to the 639-1 code when one exists", () => {
    expect(canonicalLangCode("kor")?.code).toBe("ko");
    expect(canonicalLangCode("jpn")?.code).toBe("ja");
  });
  it("keeps 639-3 for languages without a 639-1 code", () => {
    const fil = canonicalLangCode("fil");
    expect(fil?.code).toBe("fil");
    expect(fil?.iso6391).toBeUndefined();
  });
  it("rejects names, empty strings, and unknown codes", () => {
    expect(isLangCode("Korean")).toBe(false);
    expect(isLangCode("")).toBe(false);
    expect(isLangCode("zz")).toBe(false);
    expect(isLangCode("xx-YY")).toBe(false);
  });
});
