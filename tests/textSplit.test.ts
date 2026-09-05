import { describe, expect, it } from "vitest";
import { TELEGRAM_MESSAGE_LIMIT, splitForMessenger } from "../src/core/textSplit.js";

const squash = (s: string): string => s.replace(/\s+/gu, "");

describe("splitForMessenger", () => {
  it("returns a single part when under the limit and [] for blank input", () => {
    expect(splitForMessenger("hello")).toEqual(["hello"]);
    expect(splitForMessenger("  \n ")).toEqual([]);
    expect(TELEGRAM_MESSAGE_LIMIT).toBe(4096);
  });

  it("splits at paragraph boundaries first and preserves order", () => {
    const [a, b, c] = [
      "one".padEnd(30, "a"),
      "two".padEnd(30, "b"),
      "three".padEnd(30, "c"),
    ] as const;
    const parts = splitForMessenger([a, b, c].join("\n\n"), 64);
    expect(parts).toEqual([`${a}\n\n${b}`, c]);
  });

  it("falls back to lines, sentences, then graphemes for oversize paragraphs", () => {
    const line = "Short line.";
    const long = "First sentence here. Second sentence there! Third one? " + "x".repeat(50);
    const parts = splitForMessenger(`${line}\n${long}`, 40);
    expect(parts.every((p) => p.length <= 40)).toBe(true);
    expect(parts[0]).toBe(line);
    expect(parts[1]).toBe("First sentence here.");
    expect(squash(parts.join(""))).toBe(squash(`${line}${long}`));
  });

  it("never breaks surrogate pairs, combining marks, or ZWJ emoji", () => {
    const text = "𠮷野家 اللُّغَةُ 👨‍👩‍👧‍👦 é ".repeat(20);
    const parts = splitForMessenger(text, 9);
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
    expect(parts.some((p) => lone.test(p))).toBe(false);
    expect(parts.some((p) => p.endsWith("‍") || p.startsWith("́"))).toBe(false);
    expect(squash(parts.join(""))).toBe(squash(text));
  });

  it("handles a realistic 10k-char document under the Telegram limit in order", () => {
    const doc = Array.from(
      { length: 40 },
      (_, i) => `# Section ${String(i)}\n\n${"Sentence number one. ".repeat(12)}`,
    ).join("\n\n");
    const parts = splitForMessenger(doc);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.length <= TELEGRAM_MESSAGE_LIMIT)).toBe(true);
    expect(squash(parts.join(""))).toBe(squash(doc));
    expect(parts[0]?.startsWith("# Section 0")).toBe(true);
  });

  it("rejects a non-positive limit", () => {
    expect(() => splitForMessenger("x", 0)).toThrow(RangeError);
  });
});
