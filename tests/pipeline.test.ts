import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExtractors } from "../src/adapters/extractors/index.js";
import { FrancDetector, Pipeline, type Config, type ExtractedDoc } from "../src/core/index.js";
import { CapturingLogger } from "../src/mocks/capturingLogger.js";
import { FakeMessenger } from "../src/mocks/fakeMessenger.js";
import { fakePhrases } from "../src/mocks/fakePhrases.js";
import { FakeTranslator } from "../src/mocks/fakeTranslator.js";
import { FixedClock } from "../src/mocks/fixedClock.js";
import { FixtureExtractor, syntheticDoc } from "../src/mocks/fixtureExtractor.js";
import { MemorySettings } from "../src/mocks/memorySettings.js";

const MB = 1024 * 1024;
const baseConfig: Config = {
  nativeLang: "ko",
  provider: { kind: "claude", apiKeyRef: "env:X" },
  messenger: { kind: "telegram", tokenRef: "env:Y" },
  mode: "smart",
  inlineThresholdChars: 3000,
  maxChars: 120_000,
  access: { ownerUserId: "owner", allowedChatIds: [] },
  limits: { docsPerChatPerHour: 20, dailyChars: 1_000_000 },
};
const SIGNATURE = "ZQXJV-SIGNATURE-7731";
const short: ExtractedDoc = syntheticDoc(2000);
const long: ExtractedDoc = syntheticDoc(30_000, 8);
const signed: ExtractedDoc = {
  ...short,
  text: `${short.text}\n\n${SIGNATURE}`,
  sections: [...short.sections, { text: SIGNATURE }],
};

interface Harness {
  pipeline: Pipeline;
  messenger: FakeMessenger;
  translator: FakeTranslator;
  settings: MemorySettings;
  logger: CapturingLogger;
  extractor: FixtureExtractor;
}

function harness(
  o: {
    config?: Partial<Config>;
    translator?: FakeTranslator;
    fixtures?: Record<
      string,
      | ExtractedDoc
      | {
          error:
            { kind: "empty_text" } | { kind: "encrypted" } | { kind: "corrupt"; detail: string };
        }
    >;
    chunkChars?: number;
    detectorLang?: string;
    pairingCode?: string;
    maxChunksPerDoc?: number;
  } = {},
): Harness {
  const messenger = new FakeMessenger();
  const translator = o.translator ?? new FakeTranslator();
  const settings = new MemorySettings({ ...baseConfig, ...o.config });
  const logger = new CapturingLogger();
  const extractor = new FixtureExtractor(o.fixtures ?? { pdf: short, txt: long, md: signed });
  const detector = {
    detect: (t: string) => ({
      lang: o.detectorLang ?? (/[가-힣]/u.test(t) ? "ko" : "en"),
      confidence: 1,
    }),
  };
  const pipeline = new Pipeline({
    messenger,
    extractors: [extractor],
    detector,
    translator,
    settings,
    phrasesFor: fakePhrases,
    logger,
    clock: new FixedClock(),
    maxBytes: 20 * MB,
    ...(o.chunkChars === undefined ? {} : { chunkChars: o.chunkChars }),
    ...(o.pairingCode === undefined ? {} : { pairingCode: o.pairingCode }),
    ...(o.maxChunksPerDoc === undefined ? {} : { maxChunksPerDoc: o.maxChunksPerDoc }),
  });
  pipeline.attach();
  return { pipeline, messenger, translator, settings, logger, extractor };
}

/** Uploads a fixture by name; the FixtureExtractor reads the name back from the bytes. */
function upload(
  h: Harness,
  chatId: string,
  fileName: string,
  sizeBytes?: number,
  mime = "application/octet-stream",
) {
  return h.messenger.emitDocument({
    chatId,
    fileName,
    mime,
    bytes: new TextEncoder().encode(fileName),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
  });
}

describe("input and extraction", () => {
  it("runs PDF, DOCX, and TXT fixtures through the real extractors end to end", async () => {
    const messenger = new FakeMessenger();
    const translator = new FakeTranslator();
    const logger = new CapturingLogger();
    const pipeline = new Pipeline({
      messenger,
      extractors: createExtractors(),
      detector: new FrancDetector(),
      translator,
      settings: new MemorySettings(baseConfig),
      phrasesFor: fakePhrases,
      logger,
      clock: new FixedClock(),
      maxBytes: 20 * MB,
    });
    pipeline.attach();
    for (const [name, mime] of [
      ["en-short.pdf", "application/pdf"],
      ["es.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["ja.txt", "text/plain"],
    ] as const) {
      const bytes = new Uint8Array(readFileSync(join("fixtures", "docs", name)));
      await messenger.emitDocument({ chatId: `chat-${name}`, fileName: name, mime, bytes });
      const texts = messenger.textsFor(`chat-${name}`);
      expect(texts[0]).toContain("[progressExtracting ko");
      expect(texts.at(-1)).toMatch(/^«KO:/u); // inline full translation via markers
    }
    expect(logger.events()).toContain("doc.done");
    expect(translator.calls.summarize).toBe(0);
  });

  it("reports scanned (empty) and encrypted PDFs in the native language without crashing", async () => {
    const h = harness({
      fixtures: {
        pdf: { error: { kind: "empty_text" } },
        docx: { error: { kind: "encrypted" } },
        txt: { error: { kind: "corrupt", detail: "x" } },
      },
    });
    await upload(h, "c", "scan.pdf");
    await upload(h, "c", "locked.docx");
    await upload(h, "c", "bad.txt");
    const texts = h.messenger.textsFor("c").filter((t) => !t.startsWith("[progressExtracting"));
    expect(texts).toEqual([
      "[extractEmpty ko scan.pdf]",
      "[extractEncrypted ko locked.docx]",
      "[extractCorrupt ko bad.txt]",
    ]);
    expect(h.translator.calls.chunks).toBe(0);
    expect(h.pipeline.lastDocumentMeta("c")).toBeUndefined();
  });

  it("rejects files over 20 MB from metadata alone — no download, no extraction", async () => {
    const h = harness();
    await upload(h, "c", "huge.pdf", 20 * MB + 1);
    expect(h.messenger.textsFor("c")).toEqual([`[rejectTooLarge ko 0 ${String(20 * MB)}]`]);
    expect(h.messenger.downloads).toEqual([]);
    expect(h.extractor.extracted).toEqual([]);
  });

  it("rejects unsupported formats with the supported list", async () => {
    const h = harness();
    await upload(h, "c", "sheet.xlsx");
    expect(h.messenger.textsFor("c")).toEqual([
      "[rejectUnsupported ko sheet.xlsx pdf,docx,txt,md]",
    ]);
    expect(h.messenger.downloads).toEqual([]);
  });
});

describe("chunking and assembly", () => {
  it("translates chunk by chunk along section boundaries and reassembles in order", async () => {
    const h = harness({ chunkChars: 600 });
    await upload(h, "c", "doc.pdf");
    const posts = h.messenger.textsFor("c");
    const body = posts.filter((t) => t.startsWith("«")).join("\n\n");
    const markers = body.match(/«KO:/gu) ?? [];
    expect(markers.length).toBeGreaterThan(1);
    expect(h.translator.requestedChunks).toEqual(h.translator.requestedChunks.map((_, i) => i)); // ascending, no gaps
    // Section headings survive and appear in order inside the markers
    const headings = [...body.matchAll(/# Section (\d)/gu)].map((m) => Number(m[1]));
    expect(headings).toEqual([1, 2, 3, 4]);
    expect(h.translator.calls.chunks).toBe(h.translator.requestedChunks.length);
  });

  it("retries a failed chunk once and completes", async () => {
    const t = new FakeTranslator({ failOnChunk: 1 });
    const h = harness({ chunkChars: 600, translator: t });
    await upload(h, "c", "doc.pdf");
    expect(h.messenger.textsFor("c").some((x) => x.startsWith("«KO:"))).toBe(true);
    expect(h.translator.requestedChunks.filter((i) => i === 1)).toHaveLength(2);
    expect(h.logger.events()).toContain("chunk.failed");
  });

  it("reports partial failure and posts no translation when a chunk fails twice", async () => {
    const t = new FakeTranslator({ failOnChunk: 2, failTimes: 2 });
    const h = harness({ chunkChars: 600, translator: t });
    await upload(h, "c", "doc.pdf");
    const texts = h.messenger.textsFor("c");
    expect(texts.some((x) => x.startsWith("«KO:"))).toBe(false);
    expect(texts.at(-1)).toMatch(/^\[translationFailed ko 2\/\d+\]$/u);
    expect(h.messenger.filesFor("c")).toEqual([]);
  });

  it("keeps RTL and CJK characters intact through split and reassembly", async () => {
    const ar = readFileSync(join("fixtures", "docs", "ar-rtl.txt"), "utf8");
    const ja = readFileSync(join("fixtures", "docs", "ja.txt"), "utf8");
    const { structureText } = await import("../src/core/sections.js");
    const h = harness({
      chunkChars: 60,
      fixtures: { txt: structureText(ar), md: structureText(ja) },
      detectorLang: "und",
    });
    await upload(h, "a", "x.txt");
    await upload(h, "j", "y.md");
    const strip = (s: string): string =>
      s
        .replace(/«KO:|»/gu, "")
        .replace(/^#+ /gmu, "")
        .replace(/\s/gu, "");
    const outA = h.messenger
      .textsFor("a")
      .filter((t) => t.startsWith("«"))
      .join("");
    const outJ = h.messenger
      .textsFor("j")
      .filter((t) => t.startsWith("«"))
      .join("");
    expect(strip(outA)).toBe(strip(ar));
    expect(strip(outJ)).toBe(strip(ja));
  });
});

describe("policy and commands", () => {
  it("golden plans: inline for short smart, summary+file for long smart", async () => {
    const h = harness();
    await upload(h, "s", "doc.pdf");
    expect(h.messenger.textsFor("s").at(-1)).toMatch(/^«KO:/u);
    expect(h.messenger.filesFor("s")).toEqual([]);

    await upload(h, "l", "doc.txt");
    const texts = h.messenger.textsFor("l");
    expect(texts).toContain("[progressSummarizing ko]");
    expect(texts.at(-1)).toMatch(/^«KO:Section 1 \/ Section 2/u); // summary = section titles marker
    const files = h.messenger.filesFor("l");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: "doc.ko.md",
      caption: "[fileCaption ko doc.ko.md ko]",
    });
    expect(new TextDecoder().decode(files[0]?.content).startsWith("«KO:")).toBe(true);
    expect(h.translator.calls.summarize).toBe(1);
  });

  it("golden plans: summary mode on short doc, full mode on long doc, same language, over max, unsupported", async () => {
    const summary = harness({ config: { mode: "summary" } });
    await upload(summary, "c", "doc.pdf");
    expect(summary.messenger.filesFor("c")).toHaveLength(1);
    expect(summary.translator.calls.summarize).toBe(1);

    const full = harness({ config: { mode: "full" } });
    await upload(full, "c", "doc.txt");
    expect(full.messenger.textsFor("c")).toContain("[fileFullNote ko doc.txt]");
    expect(full.messenger.filesFor("c")).toHaveLength(1);
    expect(full.translator.calls.summarize).toBe(0);

    const same = harness({ fixtures: { pdf: syntheticDoc(2000, 2, "ko") } });
    await upload(same, "c", "doc.pdf");
    expect(same.messenger.textsFor("c").at(-1)).toBe("[skipSameLang ko ko]");
    expect(same.translator.calls.chunks).toBe(0);

    const over = harness({ config: { maxChars: 10_000 } });
    await upload(over, "c", "doc.txt");
    expect(over.messenger.textsFor("c").at(-1)).toMatch(/^\[rejectOverMax ko \d+ 10000\]$/u);
    expect(over.translator.calls.chunks).toBe(0);

    const unsupported = harness();
    await upload(unsupported, "c", "a.xlsx");
    expect(unsupported.messenger.textsFor("c")).toEqual([
      "[rejectUnsupported ko a.xlsx pdf,docx,txt,md]",
    ]);
  });

  it("/full re-runs the last document as file_full; /summary as summary+file; none -> notice", async () => {
    const h = harness();
    await h.messenger.emitCommand({ chatId: "c", name: "full" });
    expect(h.messenger.textsFor("c")).toEqual(["[noLastDocument ko]"]);

    await upload(h, "c", "doc.pdf");
    expect(h.messenger.filesFor("c")).toEqual([]);
    await h.messenger.emitCommand({ chatId: "c", name: "full" });
    expect(h.messenger.filesFor("c")).toHaveLength(1);
    expect(h.messenger.textsFor("c")).toContain("[fileFullNote ko doc.pdf]");
    expect(h.messenger.downloads).toHaveLength(2); // re-download by file reference, content never kept

    await h.messenger.emitCommand({ chatId: "c", name: "summary" });
    expect(h.messenger.filesFor("c")).toHaveLength(2);
    expect(h.translator.calls.summarize).toBe(1);
    expect(h.pipeline.lastDocumentMeta("c")).toMatchObject({ fileName: "doc.pdf" });
  });

  it("/full on a same-language document still produces the file (explicit request)", async () => {
    const h = harness({ fixtures: { pdf: syntheticDoc(2000, 2, "ko") } });
    await upload(h, "c", "doc.pdf");
    await h.messenger.emitCommand({ chatId: "c", name: "full" });
    expect(h.messenger.filesFor("c")).toHaveLength(1);
  });

  it("/mode and /lang update settings with confirmation, and reject bad arguments", async () => {
    const h = harness();
    await h.messenger.emitCommand({ chatId: "c", name: "mode", arg: "FULL" });
    expect(h.settings.get().mode).toBe("full");
    await h.messenger.emitCommand({ chatId: "c", name: "mode", arg: "loud" });
    await h.messenger.emitCommand({ chatId: "c", name: "mode" });
    await h.messenger.emitCommand({ chatId: "c", name: "lang", arg: "jpn" });
    expect(h.settings.get().nativeLang).toBe("ja");
    await h.messenger.emitCommand({ chatId: "c", name: "lang", arg: "Klingon" });
    expect(h.messenger.textsFor("c")).toEqual([
      "[modeChanged ko full]",
      "[modeInvalid ko loud smart|full|summary]",
      "[modeInvalid ko - smart|full|summary]",
      "[langChanged ja ja]",
      "[langInvalid ja Klingon]",
    ]);
    expect(h.settings.saves).toHaveLength(2);
    // subsequent documents translate into the new language
    await upload(h, "c", "doc.pdf");
    expect(h.messenger.textsFor("c").at(-1)).toMatch(/^«JA:/u);
  });
});

describe("posting and privacy", () => {
  it("splits an inline translation over 4,096 chars into ordered messages", async () => {
    const h = harness({
      config: { inlineThresholdChars: 100_000 },
      fixtures: { txt: syntheticDoc(12_000, 6) },
    });
    await upload(h, "c", "doc.txt");
    const parts = h.messenger.textsFor("c").filter((t) => !t.startsWith("["));
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    const joined = parts.join("\n\n");
    const order = [...joined.matchAll(/# Section (\d)/gu)].map((m) => Number(m[1]));
    expect(order).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("posts only to the originating chat", async () => {
    const h = harness();
    await upload(h, "origin", "doc.pdf");
    await upload(h, "other", "doc.txt");
    await h.messenger.emitCommand({ chatId: "origin", name: "full" });
    for (const p of h.messenger.posts) expect(["origin", "other"]).toContain(p.chatId);
    expect(
      h.messenger.posts
        .filter((p) => p.chatId === "other")
        .every((p) => p.kind === "file" || !p.text.includes("doc.pdf")),
    ).toBe(true);
    expect(h.messenger.filesFor("origin").map((f) => f.name)).toEqual(["doc.ko.md"]);
    expect(h.messenger.filesFor("other").map((f) => f.name)).toEqual(["doc.ko.md"]);
  });

  it("never leaks document text into logs or retained state", async () => {
    const h = harness();
    await upload(h, "c", "secret.md");
    expect(h.messenger.textsFor("c").some((t) => t.includes(SIGNATURE))).toBe(true); // the chat gets it
    expect(h.logger.dump()).not.toContain(SIGNATURE);
    expect(JSON.stringify(h.pipeline.lastDocumentMeta("c"))).not.toContain(SIGNATURE);
    expect(h.logger.events()).toEqual(
      expect.arrayContaining(["doc.received", "doc.planned", "doc.done"]),
    );
    for (const e of h.logger.entries)
      for (const v of Object.values(e.meta)) expect(typeof v).not.toBe("object");
  });

  it("cost guard: provider calls never exceed chunks + 1 summary", async () => {
    const h = harness({ chunkChars: 600, maxChunksPerDoc: 500 });
    await upload(h, "c", "doc.txt");
    const chunks = new Set(h.translator.requestedChunks).size;
    expect(h.translator.calls.chunks).toBe(chunks);
    expect(h.translator.calls.translate + h.translator.calls.summarize).toBeLessThanOrEqual(
      chunks + 1,
    );
  });
});

describe("concurrency", () => {
  it("processes two chats at once without mixing progress or results", async () => {
    const h = harness({ chunkChars: 600, maxChunksPerDoc: 500 });
    await Promise.all([upload(h, "A", "doc.pdf"), upload(h, "B", "doc.txt")]);
    const a = h.messenger.textsFor("A");
    const b = h.messenger.textsFor("B");
    expect(a[0]).toBe("[progressExtracting ko doc.pdf]");
    expect(b[0]).toBe("[progressExtracting ko doc.txt]");
    expect(a.some((t) => t.includes("doc.txt"))).toBe(false);
    expect(b.some((t) => t.includes("doc.pdf"))).toBe(false);
    expect(h.messenger.filesFor("A")).toEqual([]);
    expect(h.messenger.filesFor("B")).toHaveLength(1);
    expect(h.logger.entries.filter((e) => e.event === "doc.done")).toHaveLength(2);
  });

  it("serializes work within one chat in arrival order", async () => {
    const h = harness();
    await Promise.all([
      upload(h, "c", "doc.pdf"),
      h.messenger.emitCommand({ chatId: "c", name: "mode", arg: "summary" }),
    ]);
    const texts = h.messenger.textsFor("c");
    expect(texts[0]).toBe("[progressExtracting ko doc.pdf]");
    expect(texts.at(-1)).toBe("[modeChanged ko summary]");
  });
});

describe("access control (R1)", () => {
  it("ignores documents and re-run commands from strangers in non-allowed chats — no download, no reply", async () => {
    const h = harness();
    await h.messenger.emitDocument({
      chatId: "x",
      fileName: "doc.pdf",
      userId: "stranger",
      bytes: new TextEncoder().encode("doc.pdf"),
    });
    await h.messenger.emitCommand({ chatId: "x", userId: "stranger", name: "full" });
    expect(h.messenger.posts).toEqual([]);
    expect(h.messenger.downloads).toEqual([]);
    expect(
      h.logger.entries.filter((e) => e.event === "access.denied").map((e) => e.meta.kind),
    ).toEqual(["document", "full"]);
  });

  it("accepts documents from anyone inside an allowed chat, but settings commands stay owner-only", async () => {
    const h = harness({ config: { access: { ownerUserId: "owner", allowedChatIds: ["g"] } } });
    await h.messenger.emitDocument({
      chatId: "g",
      fileName: "doc.pdf",
      userId: "member",
      bytes: new TextEncoder().encode("doc.pdf"),
    });
    expect(h.messenger.textsFor("g").at(-1)).toMatch(/^«KO:/u);
    await h.messenger.emitCommand({ chatId: "g", userId: "member", name: "mode", arg: "full" });
    await h.messenger.emitCommand({ chatId: "g", userId: "member", name: "allow" });
    expect(h.settings.get().mode).toBe("smart");
    expect(h.messenger.textsFor("g").some((t) => t.startsWith("[modeChanged"))).toBe(false);
    await h.messenger.emitCommand({ chatId: "g", userId: "owner", name: "mode", arg: "full" });
    expect(h.settings.get().mode).toBe("full");
  });

  it("pairs the first /start with the right code, once", async () => {
    const h = harness({ config: { access: { allowedChatIds: [] } }, pairingCode: "123456" });
    await h.messenger.emitCommand({ chatId: "p", userId: "eve", name: "start", arg: "000000" });
    await h.messenger.emitCommand({ chatId: "p", userId: "eve", name: "start" });
    expect(h.messenger.posts).toEqual([]);
    expect(h.settings.get().access.ownerUserId).toBeUndefined();

    await h.messenger.emitCommand({ chatId: "p", userId: "jin", name: "start", arg: " 123456 " });
    expect(h.messenger.textsFor("p")).toEqual(["[paired ko]"]);
    expect(h.settings.get().access).toEqual({ ownerUserId: "jin", allowedChatIds: ["p"] });
    expect(h.logger.events()).toContain("access.paired");

    // code is single-use; a second stranger cannot take over, the owner just gets the greeting again
    await h.messenger.emitCommand({ chatId: "q", userId: "eve", name: "start", arg: "123456" });
    expect(h.settings.get().access.ownerUserId).toBe("jin");
    await h.messenger.emitCommand({ chatId: "q", userId: "jin", name: "start" });
    expect(h.messenger.textsFor("q")).toEqual(["[paired ko]"]);
  });

  it("owner can /allow and /deny chats, and allowed chats then accept documents", async () => {
    const h = harness();
    await h.messenger.emitDocument({
      chatId: "grp",
      fileName: "doc.pdf",
      userId: "member",
      bytes: new TextEncoder().encode("doc.pdf"),
    });
    expect(h.messenger.downloads).toEqual([]);
    await h.messenger.emitCommand({ chatId: "grp", userId: "owner", name: "allow" });
    expect(h.messenger.textsFor("grp")).toEqual(["[chatAllowed ko]"]);
    expect(h.settings.get().access.allowedChatIds).toEqual(["grp"]);
    await h.messenger.emitDocument({
      chatId: "grp",
      fileName: "doc.pdf",
      userId: "member",
      bytes: new TextEncoder().encode("doc.pdf"),
    });
    expect(h.messenger.downloads).toHaveLength(1);
    await h.messenger.emitCommand({ chatId: "grp", userId: "owner", name: "deny" });
    expect(h.settings.get().access.allowedChatIds).toEqual([]);
    expect(h.messenger.textsFor("grp").at(-1)).toBe("[chatDenied ko]");
  });
});

describe("cost and rate guards (R2)", () => {
  it("counts whitespace: the review's padding trick is rejected instead of producing 99 chunks", async () => {
    const text = ("word" + " ".repeat(3990)).repeat(100); // 399,400 chars, 400 non-whitespace
    const h = harness({ fixtures: { txt: { text, sections: [{ text }] } } });
    await upload(h, "c", "pad.txt");
    expect(h.messenger.textsFor("c").at(-1)).toMatch(/^\[rejectOverMax ko 399400 120000\]$/u);
    expect(h.translator.calls.chunks).toBe(0);
  });

  it("rejects documents that would need more chunks than maxChunksPerDoc", async () => {
    const h = harness({ chunkChars: 600, maxChunksPerDoc: 2 });
    await upload(h, "c", "doc.pdf");
    expect(h.messenger.textsFor("c").at(-1)).toMatch(/^\[rejectOverMax ko /u);
    expect(h.translator.calls.chunks).toBe(0);
    expect(h.logger.events()).toContain("doc.too_many_chunks");
  });

  it("limits documents and re-runs per chat per hour, silently counting rejected attempts too", async () => {
    const h = harness({ config: { limits: { docsPerChatPerHour: 2, dailyChars: 1_000_000 } } });
    await upload(h, "c", "doc.pdf");
    await h.messenger.emitCommand({ chatId: "c", name: "full" });
    await upload(h, "c", "doc.pdf");
    const texts = h.messenger.textsFor("c");
    expect(texts.at(-1)).toBe("[rateLimited ko 2]");
    expect(h.messenger.downloads).toHaveLength(2);
    // other chats are unaffected
    await upload(h, "d", "doc.pdf");
    expect(h.messenger.textsFor("d").at(-1)).toMatch(/^«KO:/u);
  });

  it("stops when the global daily character budget would be exceeded and charges summaries twice", async () => {
    const h = harness({ config: { limits: { docsPerChatPerHour: 20, dailyChars: 5_000 } } });
    await upload(h, "c", "doc.pdf"); // ~2,000 chars -> charged
    const used = h.pipeline.dailyCharsUsed();
    expect(used).toBeGreaterThan(1_500);
    await upload(h, "c", "doc.txt"); // 30,000-char summary path -> exceeds
    expect(h.messenger.textsFor("c").at(-1)).toBe("[dailyBudgetExhausted ko]");
    expect(h.pipeline.dailyCharsUsed()).toBe(used); // no charge on rejection
    expect(h.translator.calls.summarize).toBe(0);
  });
});
