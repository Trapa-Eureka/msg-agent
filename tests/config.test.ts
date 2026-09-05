import { describe, expect, it } from "vitest";
import {
  DEFAULT_INLINE_THRESHOLD_CHARS,
  DEFAULT_MAX_CHARS,
  parseConfig,
  parseSecretRef,
  redactSecretRef,
} from "../src/core/config.js";
import { explainConfigIssue, formatExplanations } from "../src/core/configMessages.js";

const valid = {
  nativeLang: "ko",
  provider: { kind: "claude", apiKeyRef: "env:ANTHROPIC_API_KEY" },
  messenger: { kind: "telegram", tokenRef: "literal:123:abc" },
};

function issuesOf(input: unknown) {
  const r = parseConfig(input);
  if (r.ok) throw new Error("expected failure");
  return r.error;
}

describe("parseConfig", () => {
  it("applies defaults for mode and limits", () => {
    const r = parseConfig(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mode).toBe("smart");
    expect(r.value.inlineThresholdChars).toBe(DEFAULT_INLINE_THRESHOLD_CHARS);
    expect(r.value.maxChars).toBe(DEFAULT_MAX_CHARS);
  });

  it("canonicalizes the native language code", () => {
    const r = parseConfig({ ...valid, nativeLang: "KOR" });
    expect(r.ok && r.value.nativeLang).toBe("ko");
  });

  it("reports missing required fields with their path", () => {
    const issues = issuesOf({ nativeLang: "ko", messenger: valid.messenger });
    expect(issues).toContainEqual({ code: "missing_field", path: "provider" });
  });

  it("rejects a language name instead of a code", () => {
    const issues = issuesOf({ ...valid, nativeLang: "Korean" });
    expect(issues).toEqual([{ code: "invalid_lang", path: "nativeLang", detail: "Korean" }]);
  });

  it("rejects secret refs without a prefix", () => {
    const issues = issuesOf({
      ...valid,
      provider: { kind: "claude", apiKeyRef: "ANTHROPIC_API_KEY" },
    });
    expect(issues).toEqual([{ code: "invalid_secret_ref", path: "provider.apiKeyRef" }]);
  });

  it("rejects unknown provider kind and mode", () => {
    const issues = issuesOf({
      ...valid,
      provider: { kind: "gemini", apiKeyRef: "env:X" },
      mode: "verbose",
    });
    expect(issues.map((i) => i.code).sort()).toEqual(["invalid_kind", "invalid_mode"]);
  });

  it("rejects non-positive or non-integer limits", () => {
    const issues = issuesOf({ ...valid, inlineThresholdChars: 0, maxChars: 1.5 });
    expect(issues.map((i) => i.path).sort()).toEqual(["inlineThresholdChars", "maxChars"]);
    expect(issues.every((i) => i.code === "invalid_number")).toBe(true);
  });

  it("rejects a threshold above maxChars", () => {
    const issues = issuesOf({ ...valid, inlineThresholdChars: 5000, maxChars: 4000 });
    expect(issues).toEqual([{ code: "threshold_over_max", path: "inlineThresholdChars" }]);
  });
});

describe("secret refs", () => {
  it("parses env and literal refs", () => {
    expect(parseSecretRef("env:TELEGRAM_BOT_TOKEN")).toEqual({
      kind: "env",
      varName: "TELEGRAM_BOT_TOKEN",
    });
    expect(parseSecretRef("literal:abc:def")).toEqual({ kind: "literal", value: "abc:def" });
    expect(parseSecretRef("env:lowercase")).toBeUndefined();
    expect(parseSecretRef("literal:")).toBeUndefined();
    expect(parseSecretRef("sk-plain")).toBeUndefined();
  });

  it("redacts literal values", () => {
    expect(redactSecretRef("env:ANTHROPIC_API_KEY")).toBe("env:ANTHROPIC_API_KEY");
    expect(redactSecretRef("literal:super-secret")).toBe("literal:****");
    expect(redactSecretRef("literal:super-secret")).not.toContain("super");
  });
});

describe("config messages", () => {
  it("gives cause + fix in ko and en for every issue code", () => {
    const codes = [
      "missing_field",
      "invalid_lang",
      "invalid_secret_ref",
      "invalid_mode",
      "invalid_kind",
      "invalid_number",
      "threshold_over_max",
      "invalid_value",
    ] as const;
    for (const code of codes) {
      for (const lang of ["ko", "en"] as const) {
        const e = explainConfigIssue({ code, path: "x.y", detail: "d" }, lang);
        expect(e.cause.length).toBeGreaterThan(0);
        expect(e.fix.length).toBeGreaterThan(0);
      }
    }
  });

  it("formats explanations with labels", () => {
    const text = formatExplanations([{ cause: "c", fix: "f" }], "ko");
    expect(text).toBe("원인: c\n수정 방법: f");
  });

  it("mentions the fix command for a wrong language code", () => {
    const e = explainConfigIssue(
      { code: "invalid_lang", path: "nativeLang", detail: "Korean" },
      "ko",
    );
    expect(e.fix).toContain("ko");
  });
});
