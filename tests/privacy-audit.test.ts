// T10 — privacy audit, run on every `npm run check` (guardrail 1: no document content on disk or in logs).
// Two layers: a static scan of src/ for disk-write and console APIs, and a runtime signature check
// through the assembled daemon on success and failure paths.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveConfig } from "../src/adapters/configStore.js";
import { ConsoleLogger } from "../src/adapters/consoleLogger.js";
import { runStart } from "../src/cli/start.js";
import { FakeMessenger } from "../src/mocks/fakeMessenger.js";
import { FakeTranslator } from "../src/mocks/fakeTranslator.js";
import { phrasesFor } from "../src/phrases/index.js";

// ---------- static scan ----------

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? listTs(p) : e.name.endsWith(".ts") ? [p] : [];
  });
}
const SRC = join(process.cwd(), "src");
const files = listTs(SRC).map((p) => ({
  path: relative(process.cwd(), p),
  text: readFileSync(p, "utf8"),
}));

/** Only the config store may write to disk. Everything else (extract, translate, post) stays in memory. */
const DISK_WRITE_ALLOWLIST = ["src/adapters/configStore.ts"];
const DISK_WRITE =
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdtemp|mkdtempSync|openSync|open)\s*\(/u;
/** console.* is for the CLI composition layer and scripts only (ESLint enforces this too). */
const CONSOLE_ALLOWLIST_PREFIX = ["src/cli/"];

describe("static privacy scan of src/", () => {
  it("writes to disk only from the config store", () => {
    const offenders = files
      .filter((f) => DISK_WRITE.test(f.text) && !DISK_WRITE_ALLOWLIST.includes(f.path))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("uses console only in the CLI layer", () => {
    const offenders = files
      .filter((f) => /\bconsole\.(log|error|warn|info|debug)\s*\(/u.test(f.text))
      .filter((f) => !CONSOLE_ALLOWLIST_PREFIX.some((p) => f.path.startsWith(p)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("never logs document fields by name (text, content, body, chunk text) in core or adapters", () => {
    const logCall = /logger\.(info|warn|error)\(\s*"[^"]+"\s*,\s*\{([^}]*)\}/gu;
    const offenders: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(logCall)) {
        const meta = m[2] ?? "";
        if (/\b(text|content|body|summary|parts|translated)\b\s*[:,}]/u.test(meta))
          offenders.push(`${f.path}: ${meta.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------- runtime signature check ----------

const SIGNATURES = ["QZX-BODY-SIGNATURE-4417", "KVJ-SECOND-MARKER-9920", "비밀-본문-표식-7731"];
const DOC = [
  "# Confidential Terms",
  "",
  `Clause 1. The vendor shall pay ${SIGNATURES[0] ?? ""} within thirty days of the invoice date.`,
  "",
  "## Schedule",
  "",
  `The schedule references ${SIGNATURES[1] ?? ""} and ${SIGNATURES[2] ?? ""} as delivery markers.`,
  "",
].join("\n");

let dir: string;
let messenger: FakeMessenger;
let stderrLines: string[];
let stdoutLines: string[];
let cliLines: string[];
let cwdBefore: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "message-privacy-"));
  messenger = new FakeMessenger();
  stderrLines = [];
  stdoutLines = [];
  cliLines = [];
  cwdBefore = readdirSync(process.cwd());
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdoutLines.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrLines.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function runScenario(translator: FakeTranslator): Promise<void> {
  const configPath = join(dir, ".message", "config.json");
  saveConfig(
    {
      nativeLang: "ko",
      provider: { kind: "claude", apiKeyRef: "literal:k" },
      messenger: { kind: "telegram", tokenRef: "literal:t" },
    },
    configPath,
  );
  const daemon = await runStart({
    configPath,
    env: {},
    out: (l) => cliLines.push(l),
    logger: new ConsoleLogger(), // the real logger, writing to the spied stderr
    phrasesFor,
    buildMessenger: () => messenger,
    buildProvider: () => translator,
    onSignal: () => () => undefined,
  });
  if (typeof daemon === "number") throw new Error("start failed");
  const bytes = new TextEncoder().encode(DOC);
  await messenger.emitDocument({ chatId: "c", fileName: "terms.md", mime: "text/markdown", bytes });
  await messenger.emitDocument({ chatId: "c", fileName: "terms.txt", mime: "text/plain", bytes });
  await messenger.emitCommand({ chatId: "c", name: "full" });
  await messenger.emitCommand({ chatId: "c", name: "summary" });
  await daemon.stop();
}

function expectNoSignatures(where: string, text: string): void {
  for (const sig of SIGNATURES) expect(text, `${where} leaked ${sig}`).not.toContain(sig);
}

describe("runtime signature audit through the assembled daemon", () => {
  it("success path: content reaches the chat only; logs, stdout/stderr, cwd and config dir stay clean", async () => {
    await runScenario(new FakeTranslator());
    const chat =
      messenger.textsFor("c").join("\n") +
      messenger
        .filesFor("c")
        .map((f) => new TextDecoder().decode(f.content))
        .join("\n");
    for (const sig of SIGNATURES) expect(chat).toContain(sig);

    expectNoSignatures("stderr(logger)", stderrLines.join(""));
    expectNoSignatures("stdout", stdoutLines.join(""));
    expectNoSignatures("cli output", cliLines.join("\n"));
    expect(stderrLines.length).toBeGreaterThan(3); // the logger did run
    for (const line of stderrLines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(entry)).toEqual(expect.arrayContaining(["ts", "level", "event"]));
    }
    expect(readdirSync(process.cwd())).toEqual(cwdBefore);
    expect(readdirSync(join(dir, ".message"))).toEqual(["config.json"]);
    expectNoSignatures("config.json", readFileSync(join(dir, ".message", "config.json"), "utf8"));
  });

  it("failure path: provider errors and retries never put content in logs", async () => {
    await runScenario(
      new FakeTranslator({ failOnChunk: 0, failTimes: Infinity, failSummaryTimes: Infinity }),
    );
    const err = stderrLines.join("");
    expect(err).toContain("chunk.failed");
    expect(err).toContain("doc.translate_failed");
    expectNoSignatures("stderr(logger) on failure", err);
    expectNoSignatures("cli output on failure", cliLines.join("\n"));
    expect(messenger.filesFor("c")).toEqual([]);
    expect(readdirSync(join(dir, ".message"))).toEqual(["config.json"]);
  });
});
