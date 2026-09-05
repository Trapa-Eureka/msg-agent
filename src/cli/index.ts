#!/usr/bin/env node
// CLI composition root — wires real prompts, network verifiers, and adapters. No logic here.
import { Command } from "commander";
import { Bot } from "grammy";
import prompts from "prompts";
import { ProviderError } from "../core/index.js";
import { PACKAGE_VERSION } from "../version.js";
import { defaultConfigPath, loadDotEnv } from "../adapters/configStore.js";
import { ConsoleLogger } from "../adapters/consoleLogger.js";
import { createProvider } from "../adapters/providers/index.js";
import { TelegramAdapter } from "../adapters/telegramAdapter.js";
import { phrasesFor } from "../phrases/index.js";
import type { Asker, VerifyResult } from "./init.js";
import { runInit } from "./init.js";
import { runStart } from "./start.js";
import { runStatus } from "./status.js";

const out = (line: string): void => {
  console.log(line);
};

const ask: Asker = async (q) => {
  const r = await prompts(
    q.type === "select"
      ? { type: "select", name: "v", message: q.message, choices: [...q.choices] }
      : q.type === "confirm"
        ? { type: "confirm", name: "v", message: q.message, initial: q.initial ?? true }
        : { type: q.type, name: "v", message: q.message },
  );
  const v: unknown = r.v;
  return typeof v === "string" || typeof v === "boolean" ? v : undefined;
};

function providerErrorText(e: unknown): VerifyResult {
  const kind = e instanceof ProviderError ? e.kind : "unknown";
  const fixes: Record<string, string> = {
    auth: "Check the key in the provider console and paste it again.",
    rate_limit: "The provider is rate-limiting; wait a minute and retry.",
    network: "Check your internet connection or proxy settings.",
    bad_response: "The configured model was not found; use the default or a valid model id.",
  };
  return {
    ok: false,
    cause: `Provider check failed (${kind}).`,
    fix: fixes[kind] ?? "Retry; if it persists, check the provider status page.",
  };
}

async function verifyProvider(kind: "claude" | "openai", apiKey: string): Promise<VerifyResult> {
  const r = await createProvider({ kind, apiKeyRef: "literal:x" }, apiKey).verify();
  return r.ok ? { ok: true } : providerErrorText(r.error);
}

async function botUsername(token: string): Promise<string | undefined> {
  try {
    const me = await new Bot(token).api.getMe();
    return me.username;
  } catch {
    return undefined;
  }
}

async function verifyTelegram(token: string): Promise<VerifyResult> {
  const u = await botUsername(token);
  return u === undefined
    ? {
        ok: false,
        cause: "Telegram rejected the token.",
        fix: "Copy the full token from @BotFather (/mybots → API Token) and paste it again.",
      }
    : { ok: true, detail: u };
}

const program = new Command();
program
  .name("msg-agent")
  .version(PACKAGE_VERSION)
  .option("-c, --config <path>", "config file path", defaultConfigPath());

program
  .command("init")
  .description("Onboarding: native language, provider + API key, Telegram bot token")
  .action(async () => {
    loadDotEnv();
    process.exitCode = await runInit({
      ask,
      out,
      configPath: program.opts<{ config: string }>().config,
      env: process.env,
      verifyProvider,
      verifyTelegram,
    });
  });

program
  .command("start")
  .description("Start the long-polling daemon")
  .action(async () => {
    loadDotEnv();
    const logger = new ConsoleLogger();
    const configPath = program.opts<{ config: string }>().config;
    const result = await runStart({
      configPath,
      env: process.env,
      out,
      logger,
      phrasesFor,
      buildMessenger: (token) =>
        new TelegramAdapter({
          token,
          onError: (e, fatal) => {
            logger.error(fatal ? "telegram.polling_failed" : "telegram.error", {
              error: e instanceof Error ? e.name : "unknown",
            });
            if (fatal) process.exitCode = 1;
          },
        }),
    });
    if (typeof result === "number") process.exitCode = result;
  });

program
  .command("status")
  .description("Show config summary and bot connectivity")
  .action(async () => {
    loadDotEnv();
    process.exitCode = await runStatus({
      configPath: program.opts<{ config: string }>().config,
      env: process.env,
      out,
      checkBot: botUsername,
    });
  });

await program.parseAsync(process.argv);
