// Daemon: load config, resolve secrets, assemble adapters + pipeline, run long polling until a signal.
import type {
  Config,
  Logger,
  MessengerAdapter,
  Phrases,
  TranslatorProvider,
} from "../core/index.js";
import {
  FrancDetector,
  Pipeline,
  explainConfigError,
  explainSecretError,
  formatExplanations,
} from "../core/index.js";
import { createExtractors } from "../adapters/extractors/index.js";
import { createProvider } from "../adapters/providers/index.js";
import type { EnvSource } from "../adapters/configStore.js";
import { loadConfig, resolveSecret } from "../adapters/configStore.js";
import { FileSettings } from "../adapters/fileSettings.js";
import { TELEGRAM_MAX_DOWNLOAD_BYTES } from "../adapters/telegramAdapter.js";
import { randomInt } from "node:crypto";
import { text, uiLangFor } from "./text.js";

export interface StartDeps {
  configPath: string;
  env: EnvSource;
  out: (line: string) => void;
  logger: Logger;
  phrasesFor: (lang: string) => Phrases;
  buildMessenger: (token: string) => MessengerAdapter;
  buildProvider?: (config: Config, apiKey: string) => TranslatorProvider;
  /** Registers shutdown handlers; returns a function to unregister. Tests pass a no-op. */
  onSignal?: (handler: () => void) => () => void;
  botUsername?: string;
}

export interface Daemon {
  stop(): Promise<void>;
  config: Config;
}

/** Returns a running daemon, or an exit code when startup fails. */
export async function runStart(d: StartDeps): Promise<Daemon | number> {
  const loaded = loadConfig(d.configPath);
  const ui = uiLangFor(loaded.ok ? loaded.value.nativeLang : undefined);
  const t = text(ui);
  if (!loaded.ok) {
    d.out(
      loaded.error.kind === "not_found"
        ? t.noConfig
        : formatExplanations(explainConfigError(loaded.error, ui), ui),
    );
    return 1;
  }
  const config = loaded.value;

  const apiKey = resolveSecret(config.provider.apiKeyRef, "provider.apiKeyRef", d.env);
  if (!apiKey.ok) {
    d.out(formatExplanations([explainSecretError(apiKey.error, ui)], ui));
    return 1;
  }
  const token = resolveSecret(config.messenger.tokenRef, "messenger.tokenRef", d.env);
  if (!token.ok) {
    d.out(formatExplanations([explainSecretError(token.error, ui)], ui));
    return 1;
  }

  const translator = (d.buildProvider ?? ((c, k) => createProvider(c.provider, k)))(
    config,
    apiKey.value,
  );
  const messenger = d.buildMessenger(token.value);
  const settings = new FileSettings(config, d.configPath);
  const pairingCode =
    config.access.ownerUserId === undefined
      ? String(randomInt(0, 1_000_000)).padStart(6, "0")
      : undefined;
  const pipeline = new Pipeline({
    ...(pairingCode === undefined ? {} : { pairingCode }),
    messenger,
    extractors: createExtractors(),
    detector: new FrancDetector(),
    translator,
    settings,
    phrasesFor: d.phrasesFor,
    logger: d.logger,
    clock: { now: () => Date.now() },
    maxBytes: TELEGRAM_MAX_DOWNLOAD_BYTES,
  });
  pipeline.attach();
  await messenger.start();
  d.logger.info("daemon.started", {
    nativeLang: config.nativeLang,
    provider: config.provider.kind,
    mode: config.mode,
  });
  d.out(t.starting(d.botUsername, config.nativeLang));
  if (pairingCode !== undefined) d.out(t.pairingHint(pairingCode));

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      d.out(t.stopping);
      await messenger.stop();
      d.logger.info("daemon.stopped");
    })();
    return stopping;
  };
  const unregister = (d.onSignal ?? defaultOnSignal)(() => {
    void stop();
  });
  return {
    config,
    stop: async () => {
      unregister();
      await stop();
    },
  };
}

function defaultOnSignal(handler: () => void): () => void {
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}
