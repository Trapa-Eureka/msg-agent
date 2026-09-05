// Small ports the pipeline depends on. Implemented by adapters (IO) and mocks (tests).
import type { Config } from "./config.js";

export interface SettingsStore {
  get(): Config;
  set(next: Config): Promise<void>;
}

export type LogValue = string | number | boolean | undefined;
export type LogMeta = Readonly<Record<string, LogValue>>;

/** Metadata-only logger. Callers must never pass document text (guardrail 1). */
export interface Logger {
  info(event: string, meta?: LogMeta): void;
  warn(event: string, meta?: LogMeta): void;
  error(event: string, meta?: LogMeta): void;
}

export interface Clock {
  now(): number;
}
