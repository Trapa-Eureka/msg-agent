import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveConfig } from "../src/adapters/configStore.js";
import type { Config, ConfigInput } from "../src/core/index.js";
import type { Asker, Question, VerifyResult } from "../src/cli/init.js";
import { languageChoices, resolveLanguageInput, runInit } from "../src/cli/init.js";
import { runStart } from "../src/cli/start.js";
import { runStatus } from "../src/cli/status.js";
import { uiLangFor } from "../src/cli/text.js";
import type { UiLang } from "../src/cli/text.js";
import { CapturingLogger } from "../src/mocks/capturingLogger.js";
import { FakeMessenger } from "../src/mocks/fakeMessenger.js";
import { fakePhrases } from "../src/mocks/fakePhrases.js";
import { FakeTranslator } from "../src/mocks/fakeTranslator.js";

let dir: string;
let configPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "message-cli-"));
  configPath = join(dir, ".msg-agent", "config.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Scripted asker: answers in order; records the questions it was asked. */
function scripted(answers: (string | boolean | undefined)[]): { ask: Asker; asked: Question[] } {
  const asked: Question[] = [];
  const queue = [...answers];
  const ask: Asker = (q) => {
    asked.push(q);
    return Promise.resolve(queue.shift());
  };
  return { ask, asked };
}
const okVerify = (): Promise<VerifyResult> => Promise.resolve({ ok: true });
const okTelegram = (): Promise<VerifyResult> =>
  Promise.resolve({ ok: true, detail: "message_bot" });
const failVerify = (): Promise<VerifyResult> =>
  Promise.resolve({
    ok: false,
    cause: "Provider check failed (auth).",
    fix: "Paste the key again.",
  });

function initDeps(
  answers: (string | boolean | undefined)[],
  env: Record<string, string> = {},
  verifyProvider = okVerify,
) {
  const s = scripted(answers);
  const lines: string[] = [];
  return {
    deps: {
      ask: s.ask,
      out: (l: string) => lines.push(l),
      configPath,
      env,
      verifyProvider,
      verifyTelegram: okTelegram,
      uiLang: "en" as UiLang,
    },
    asked: s.asked,
    lines,
  };
}

describe("init", () => {
  it("asks three questions, verifies, saves literal refs with mode 600, and never echoes secrets", async () => {
    const { deps, asked, lines } = initDeps(["en", "claude", "sk-ant-SECRET", "123:TOKEN-SECRET"]);
    expect(await runInit(deps)).toBe(0);
    expect(asked.map((q) => q.type)).toEqual(["select", "select", "password", "password"]);
    const saved = JSON.parse(readFileSync(configPath, "utf8")) as Config;
    expect(saved).toMatchObject({
      nativeLang: "en",
      provider: { kind: "claude", apiKeyRef: "literal:sk-ant-SECRET" },
      messenger: { kind: "telegram", tokenRef: "literal:123:TOKEN-SECRET" },
      mode: "smart",
    });
    const output = lines.join("\n");
    expect(output).not.toContain("SECRET");
    expect(output).toContain("@message_bot");
    expect(output).toContain("Config saved");
    expect(output).toContain("Invite the bot");
  });

  it("switches to Korean wording once the native language is Korean", async () => {
    const { deps, lines } = initDeps(["ko", "claude", "k", "t"]);
    deps.uiLang = "ko";
    expect(await runInit(deps)).toBe(0);
    expect(lines.some((l) => l.includes("저장했습니다"))).toBe(true);
  });

  it("offers an existing environment variable and stores an env: reference", async () => {
    const { deps, asked } = initDeps(["en", "openai", true, true], {
      OPENAI_API_KEY: "from-env",
      TELEGRAM_BOT_TOKEN: "tok",
    });
    expect(await runInit(deps)).toBe(0);
    expect(asked.filter((q) => q.type === "confirm")).toHaveLength(2);
    const saved = JSON.parse(readFileSync(configPath, "utf8")) as Config;
    expect(saved.provider.apiKeyRef).toBe("env:OPENAI_API_KEY");
    expect(saved.messenger.tokenRef).toBe("env:TELEGRAM_BOT_TOKEN");
  });

  it("declining the env value falls back to typing a literal", async () => {
    const { deps } = initDeps(["en", "claude", false, "typed-key", "tok"], {
      ANTHROPIC_API_KEY: "env-key",
    });
    expect(await runInit(deps)).toBe(0);
    const saved = JSON.parse(readFileSync(configPath, "utf8")) as Config;
    expect(saved.provider.apiKeyRef).toBe("literal:typed-key");
  });

  it("shows cause + fix on verification failure and re-asks, then succeeds", async () => {
    let calls = 0;
    const flaky = (): Promise<VerifyResult> => (++calls === 1 ? failVerify() : okVerify());
    const { deps, asked, lines } = initDeps(["en", "claude", "bad", "good", "tok"], {}, flaky);
    expect(await runInit(deps)).toBe(0);
    expect(asked.filter((q) => q.type === "password")).toHaveLength(3);
    const output = lines.join("\n");
    expect(output).toContain("Cause: Provider check failed (auth).");
    expect(output).toContain("Fix: Paste the key again.");
    expect(output).toContain("2 attempts left");
  });

  it("aborts with exit code 1 after three failed attempts and writes no config", async () => {
    const { deps, lines } = initDeps(["en", "claude", "a", "b", "c", "d"], {}, failVerify);
    expect(await runInit(deps)).toBe(1);
    expect(lines.at(-1)).toContain("aborted");
    expect(() => readFileSync(configPath)).toThrow();
  });

  it("re-asks an unknown language and aborts on cancel", async () => {
    const { deps, asked } = initDeps(["Nonexistentese", "tlh", undefined]);
    expect(await runInit(deps)).toBe(1);
    expect(asked.filter((q) => q.type === "select")).toHaveLength(3);
  });

  it("offers exactly the ten onboarding languages with bilingual titles", () => {
    const choices = languageChoices();
    expect(choices.map((c) => c.value)).toEqual([
      "ko",
      "en",
      "es",
      "fr",
      "de",
      "ja",
      "zh",
      "it",
      "ru",
      "la",
    ]);
    expect(choices[0]).toEqual({ title: "한국어 · Korean (ko)", value: "ko" });
    expect(resolveLanguageInput("KOR")).toBe("ko");
    expect(resolveLanguageInput("Latin")).toBe("la");
  });
});

const config: ConfigInput = {
  nativeLang: "ko",
  provider: { kind: "claude", apiKeyRef: "env:ANTHROPIC_API_KEY" },
  messenger: { kind: "telegram", tokenRef: "literal:123:abc" },
  access: { ownerUserId: "owner", allowedChatIds: [] },
};

function startDeps(env: Record<string, string>) {
  const messenger = new FakeMessenger();
  const translator = new FakeTranslator();
  const logger = new CapturingLogger();
  const lines: string[] = [];
  const signals: (() => void)[] = [];
  const deps = {
    configPath,
    env,
    out: (l: string) => lines.push(l),
    logger,
    phrasesFor: fakePhrases,
    buildMessenger: () => messenger,
    buildProvider: () => translator,
    onSignal: (h: () => void) => {
      signals.push(h);
      return () => signals.splice(0);
    },
    botUsername: "message_bot",
  };
  return { deps, messenger, translator, logger, lines, signals };
}

describe("start", () => {
  it("assembles the pipeline, processes a document end to end, and stops on signal", async () => {
    saveConfig(config, configPath);
    const s = startDeps({ ANTHROPIC_API_KEY: "k" });
    const d = await runStart(s.deps);
    expect(typeof d).not.toBe("number");
    if (typeof d === "number") return;
    expect(s.messenger.started).toBe(true);
    expect(s.lines.at(-1)).toContain("@message_bot");
    expect(s.logger.events()).toContain("daemon.started");

    await s.messenger.emitDocument({
      chatId: "c",
      fileName: "n.txt",
      mime: "text/plain",
      bytes: new TextEncoder().encode("# Title\n\nHello world, this is a test document."),
    });
    expect(s.messenger.textsFor("c").at(-1)).toMatch(/^«KO:/u);

    expect(s.signals).toHaveLength(1);
    s.signals[0]?.();
    await d.stop();
    expect(s.messenger.stopped).toBe(true);
    expect(s.logger.events()).toContain("daemon.stopped");
  });

  it("exits 1 with an init hint when no config exists", async () => {
    const s = startDeps({});
    expect(await runStart(s.deps)).toBe(1);
    expect(s.lines.join("\n")).toContain("init");
    expect(s.messenger.started).toBe(false);
  });

  it("exits 1 with the variable name when a secret cannot be resolved", async () => {
    saveConfig(config, configPath);
    const s = startDeps({});
    expect(await runStart(s.deps)).toBe(1);
    expect(s.lines.join("\n")).toContain("ANTHROPIC_API_KEY");
    expect(s.lines.join("\n")).toContain(".env");
  });

  it("/mode from the chat persists to the config file", async () => {
    saveConfig(config, configPath);
    const s = startDeps({ ANTHROPIC_API_KEY: "k" });
    const d = await runStart(s.deps);
    if (typeof d === "number") throw new Error("start failed");
    await s.messenger.emitCommand({ chatId: "c", name: "mode", arg: "full" });
    expect((JSON.parse(readFileSync(configPath, "utf8")) as Config).mode).toBe("full");
    await d.stop();
  });
});

describe("status", () => {
  it("prints a redacted summary and the bot check result", async () => {
    saveConfig(
      {
        ...config,
        provider: { kind: "claude", apiKeyRef: "literal:sk-SECRET", model: "claude-opus-5" },
      },
      configPath,
    );
    const lines: string[] = [];
    const code = await runStatus({
      configPath,
      env: {},
      out: (l) => lines.push(l),
      checkBot: (t) => Promise.resolve(t === "123:abc" ? "message_bot" : undefined),
    });
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).not.toContain("SECRET");
    expect(output).toContain("literal:****");
    expect(output).toContain("mode 600");
    expect(output).toContain("claude / claude-opus-5");
    expect(output).toContain("@message_bot");
  });

  it("returns 1 when the bot is unreachable or config is missing", async () => {
    const lines: string[] = [];
    expect(
      await runStatus({
        configPath,
        env: {},
        out: (l) => lines.push(l),
        checkBot: () => Promise.resolve(undefined),
      }),
    ).toBe(1);
    expect(lines.join("\n")).toContain("init");
    saveConfig(config, configPath);
    expect(
      await runStatus({
        configPath,
        env: {},
        out: () => undefined,
        checkBot: () => Promise.resolve(undefined),
      }),
    ).toBe(1);
  });
});

describe("uiLangFor", () => {
  it("follows the native language, else the LANG environment", () => {
    expect(uiLangFor("ko")).toBe("ko");
    expect(uiLangFor("ja")).toBe("en");
    expect(uiLangFor(undefined, "ko_KR.UTF-8")).toBe("ko");
    expect(uiLangFor(undefined, "en_US.UTF-8")).toBe("en");
  });
});
