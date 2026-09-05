// configStore — ~/.message/config.json (mode 600), env-ref resolution, .env loading. DESIGN §6.
// The only place that touches the filesystem for configuration.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Config, ConfigInput, Result } from "../core/index.js";
import { err, ok, parseConfig, parseSecretRef } from "../core/index.js";
import type { ConfigError, SecretError } from "../core/index.js";

export const CONFIG_DIR_NAME = ".message";
export const CONFIG_FILE_NAME = "config.json";
export const CONFIG_FILE_MODE = 0o600;
export const CONFIG_DIR_MODE = 0o700;

export type EnvSource = Readonly<Record<string, string | undefined>>;

export function defaultConfigPath(home: string = homedir()): string {
  return join(home, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

function errorDetail(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Loads and validates the config file. Never logs its contents. */
export function loadConfig(path: string = defaultConfigPath()): Result<Config, ConfigError> {
  if (!existsSync(path)) return err({ kind: "not_found", path });
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return err({ kind: "unreadable", path, detail: errorDetail(e) });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return err({ kind: "invalid_json", path, detail: errorDetail(e) });
  }
  const parsed = parseConfig(json);
  if (!parsed.ok) return err({ kind: "invalid", path, issues: parsed.error });
  return ok(parsed.value);
}

/**
 * Validates and writes the config. Creates the directory (700) and forces file mode 600
 * even when the file already existed with looser permissions (guardrail 4).
 */
export function saveConfig(
  input: ConfigInput,
  path: string = defaultConfigPath(),
): Result<Config, ConfigError> {
  const parsed = parseConfig(input);
  if (!parsed.ok) return err({ kind: "invalid", path, issues: parsed.error });
  try {
    mkdirSync(dirname(path), { recursive: true, mode: CONFIG_DIR_MODE });
    writeFileSync(path, `${JSON.stringify(parsed.value, null, 2)}\n`, {
      encoding: "utf8",
      mode: CONFIG_FILE_MODE,
    });
    chmodSync(path, CONFIG_FILE_MODE);
  } catch (e) {
    return err({ kind: "unreadable", path, detail: errorDetail(e) });
  }
  return ok(parsed.value);
}

/** Octal permission bits of the config file, for `status` and tests. */
export function configFileMode(path: string = defaultConfigPath()): number | undefined {
  if (!existsSync(path)) return undefined;
  return statSync(path).mode & 0o777;
}

/**
 * Resolves a SecretRef to its value. `field` is only used for error messages ("provider.apiKeyRef").
 * The resolved value must never be logged or echoed by callers.
 */
export function resolveSecret(
  ref: string,
  field: string,
  env: EnvSource = process.env,
): Result<string, SecretError> {
  const parsed = parseSecretRef(ref);
  if (parsed === undefined) return err({ kind: "malformed_ref", field });
  if (parsed.kind === "literal") {
    return parsed.value.trim() === "" ? err({ kind: "empty", field }) : ok(parsed.value);
  }
  const value = env[parsed.varName];
  if (value === undefined) return err({ kind: "env_missing", field, varName: parsed.varName });
  if (value.trim() === "") return err({ kind: "empty", field });
  return ok(value);
}

/**
 * Loads `<cwd>/.env` into process.env when present (no dependency: Node >= 20.12 `process.loadEnvFile`).
 * Existing variables are not overridden. Returns whether a file was loaded.
 */
export function loadDotEnv(cwd: string = process.cwd()): boolean {
  const path = join(cwd, ".env");
  if (!existsSync(path)) return false;
  process.loadEnvFile(path);
  return true;
}
