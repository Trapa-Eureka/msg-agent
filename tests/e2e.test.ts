// T9 — e2e-mock: the daemon as assembled by `start`, with only the messenger and translator faked.
// Real extractors on fixture files, real franc detector, real ko/en phrase packs, real config file.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveConfig } from "../src/adapters/configStore.js";
import type { Daemon } from "../src/cli/start.js";
import { runStart } from "../src/cli/start.js";
import type { Config } from "../src/core/index.js";
import { CapturingLogger } from "../src/mocks/capturingLogger.js";
import { FakeMessenger } from "../src/mocks/fakeMessenger.js";
import { FakeTranslator } from "../src/mocks/fakeTranslator.js";
import { phrasesFor } from "../src/phrases/index.js";

const FIXTURES = join(process.cwd(), "fixtures", "docs");
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};
// Body text that exists in fixtures and must never reach logs (guardrail 1).
const BODY_SIGNATURES = ["USD 2,400", "Delivery Milestones", "Proveedor", "業務委託契約書"];

let dir: string;
let configPath: string;
let messenger: FakeMessenger;
let translator: FakeTranslator;
let logger: CapturingLogger;
let daemon: Daemon;
let lines: string[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "message-e2e-"));
  configPath = join(dir, ".msg-agent", "config.json");
  saveConfig(
    {
      nativeLang: "ko",
      provider: { kind: "claude", apiKeyRef: "env:ANTHROPIC_API_KEY" },
      messenger: { kind: "telegram", tokenRef: "env:TELEGRAM_BOT_TOKEN" },
      access: { ownerUserId: "owner", allowedChatIds: [] },
    },
    configPath,
  );
  messenger = new FakeMessenger();
  translator = new FakeTranslator();
  logger = new CapturingLogger();
  lines = [];
  const started = await runStart({
    configPath,
    env: { ANTHROPIC_API_KEY: "test-key", TELEGRAM_BOT_TOKEN: "1:test" },
    out: (l) => lines.push(l),
    logger,
    phrasesFor,
    buildMessenger: () => messenger,
    buildProvider: () => translator,
    onSignal: () => () => undefined,
    botUsername: "message_bot",
  });
  if (typeof started === "number") throw new Error(`start failed with exit ${String(started)}`);
  daemon = started;
});
afterEach(async () => {
  await daemon.stop();
  rmSync(dir, { recursive: true, force: true });
});

function upload(chatId: string, fixture: string): Promise<unknown> {
  const ext = fixture.split(".").pop() ?? "";
  return messenger.emitDocument({
    chatId,
    fileName: fixture,
    mime: MIME[ext] ?? "application/octet-stream",
    bytes: new Uint8Array(readFileSync(join(FIXTURES, fixture))),
  });
}
const texts = (chatId: string): string[] => messenger.textsFor(chatId);
const files = (chatId: string) => messenger.filesFor(chatId);
const decode = (u: Uint8Array): string => new TextDecoder().decode(u);

describe("SPEC §7 scenarios through the assembled daemon", () => {
  it("starts with the real config and Korean UI", () => {
    expect(messenger.started).toBe(true);
    expect(lines.at(-1)).toContain("@message_bot");
    expect(lines.at(-1)).toContain("모국어 ko");
    expect(daemon.config.mode).toBe("smart");
  });

  it("short English PDF → progress in Korean, full translation inline, no file", async () => {
    await upload("c1", "en-short.pdf");
    const t = texts("c1");
    expect(t[0]).toBe('"en-short.pdf" 받았습니다. 텍스트를 추출하는 중…');
    expect(t.at(-1)).toMatch(/^«KO:# Service Agreement Overview/u);
    expect(t.at(-1)).toContain("USD 2,400");
    expect(files("c1")).toEqual([]);
    expect(translator.calls.summarize).toBe(0);
  });

  it("long English PDF → Korean summary in chat + full translation as a .md file", async () => {
    await upload("c2", "en-long.pdf");
    const t = texts("c2");
    expect(t).toContain("요약을 작성하는 중…");
    expect(t.some((x) => x.startsWith("번역 중… "))).toBe(true);
    expect(t.at(-1)).toMatch(/^«KO:Master Services Agreement \/ Section 1\. Delivery Milestones/u);
    const f = files("c2");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      name: "en-long.ko.md",
      caption: "전문 번역(한국어): en-long.ko.md",
    });
    const body = decode(f[0]?.content ?? new Uint8Array());
    expect(body.startsWith("«KO:# Master Services Agreement")).toBe(true);
    expect(body).toContain("Section 14. Delivery Milestones");
    expect(translator.calls.summarize).toBe(1);
  });

  it("Korean PDF → one-line same-language skip, no provider calls", async () => {
    await upload("c3", "ko.pdf");
    expect(texts("c3").at(-1)).toBe("이미 한국어 문서입니다.");
    expect(translator.calls.chunks + translator.calls.summarize).toBe(0);
  });

  it("scanned, encrypted, unsupported and oversize documents get Korean guidance", async () => {
    await upload("c4", "scanned.pdf");
    await upload("c4", "encrypted.pdf");
    await messenger.emitDocument({
      chatId: "c4",
      fileName: "sheet.xlsx",
      mime: "application/octet-stream",
      bytes: new Uint8Array([1]),
    });
    await upload("c4", "large-en.txt");
    const t = texts("c4").filter((x) => !x.includes("추출하는 중"));
    expect(t[0]).toContain('"scanned.pdf"에서 텍스트를 추출할 수 없습니다');
    expect(t[1]).toContain('"encrypted.pdf"은(는) 암호로 보호된 파일입니다');
    expect(t[2]).toContain('"sheet.xlsx"은(는) 지원하지 않는 형식입니다');
    expect(t[3]).toMatch(/처리 상한\(120000자\)을 넘습니다. 파일을 더 작게 나눠서/u);
    expect(translator.calls.chunks).toBe(0);
  });

  it("commands: /full, /summary, /mode, /lang — with persistence and language switch", async () => {
    await messenger.emitCommand({ chatId: "c5", name: "full" });
    expect(texts("c5").at(-1)).toContain("받은 문서가 아직 없습니다");

    await upload("c5", "en-short.pdf");
    await messenger.emitCommand({ chatId: "c5", name: "full" });
    expect(texts("c5").at(-1)).toBe('"en-short.pdf"의 전문 번역을 파일로 첨부했습니다.');
    expect(files("c5").map((f) => f.name)).toEqual(["en-short.ko.md"]);

    await messenger.emitCommand({ chatId: "c5", name: "summary" });
    expect(files("c5")).toHaveLength(2);
    expect(texts("c5").at(-1)).toMatch(/^«KO:Service Agreement Overview \/ Fees and Payment/u);

    await messenger.emitCommand({ chatId: "c5", name: "mode", arg: "summary" });
    expect(texts("c5").at(-1)).toBe("출력 모드를 summary(으)로 변경했습니다.");
    expect((JSON.parse(readFileSync(configPath, "utf8")) as Config).mode).toBe("summary");
    await messenger.emitCommand({ chatId: "c5", name: "mode", arg: "loud" });
    expect(texts("c5").at(-1)).toContain('알 수 없는 모드 "loud"');

    await messenger.emitCommand({ chatId: "c5", name: "lang", arg: "English" });
    expect(texts("c5").at(-1)).toContain('알 수 없는 언어 "English"'); // names are for onboarding; chat takes codes
    await messenger.emitCommand({ chatId: "c5", name: "lang", arg: "en" });
    expect(texts("c5").at(-1)).toBe("Native language set to English.");
    expect((JSON.parse(readFileSync(configPath, "utf8")) as Config).nativeLang).toBe("en");

    // From now on the UI is English and translations target EN; the English PDF is now same-language
    await upload("c5", "en-short.pdf");
    expect(texts("c5").at(-1)).toBe("This document is already in English.");
    await upload("c5", "ja.txt");
    expect(texts("c5").at(-1)).toMatch(/^«EN:/u);
    expect(texts("c5")).toContain('Got "ja.txt". Extracting text…');
  });

  it("two chats uploading at once get separate progress and results", async () => {
    await Promise.all([upload("A", "es.docx"), upload("B", "ja.txt")]);
    const a = texts("A");
    const b = texts("B");
    expect(a[0]).toBe('"es.docx" 받았습니다. 텍스트를 추출하는 중…');
    expect(b[0]).toBe('"ja.txt" 받았습니다. 텍스트를 추출하는 중…');
    expect(a.at(-1)).toMatch(/^«KO:# Contrato de Servicios/u);
    expect(b.at(-1)).toMatch(/^«KO:# 業務委託契約書/u);
    expect(a.some((x) => x.includes("業務"))).toBe(false);
    expect(b.some((x) => x.includes("Contrato"))).toBe(false);
    expect(logger.entries.filter((e) => e.event === "doc.done")).toHaveLength(2);
  });

  it("leaves no document content in logs, CLI output, or on disk", async () => {
    await upload("p", "en-short.pdf");
    await upload("p", "en-long.pdf");
    await upload("p", "es.docx");
    await upload("p", "ja.txt");
    const captured = logger.dump() + lines.join("\n");
    for (const sig of BODY_SIGNATURES) expect(captured).not.toContain(sig);
    for (const e of logger.entries) {
      expect(e.meta).not.toHaveProperty("text");
      for (const v of Object.values(e.meta))
        expect(typeof v === "string" ? v.length : 0).toBeLessThan(120);
    }
    // Only the config file exists in the daemon's directory — no temp files, no translations on disk
    expect(readdirSync(dir)).toEqual([".msg-agent"]);
    expect(readdirSync(join(dir, ".msg-agent"))).toEqual(["config.json"]);
    expect(readFileSync(configPath, "utf8")).not.toContain("USD");
  });

  it("cost guard across a whole session: provider calls = chunks + summaries, no duplicates", async () => {
    await upload("q", "en-short.pdf");
    await upload("q", "en-long.pdf");
    await messenger.emitCommand({ chatId: "q", name: "summary" });
    const unique = translator.requestedChunks.length;
    expect(translator.calls.chunks).toBe(unique);
    expect(translator.calls.translate).toBe(unique); // one call per chunk
    expect(translator.calls.summarize).toBe(2); // long upload + /summary
  });
});
