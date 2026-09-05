// configStore — ~/.msg-agent/config.json (mode 600), env-ref resolution, selective .env loading. DESIGN §6.
// The only place that touches the filesystem for configuration. R3: atomic writes, lstat/permission checks,
// no parser error text in user-facing output.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import type { Config, ConfigInput, Result } from "../core/index.js";
import { err, ok, parseConfig, parseSecretRef } from "../core/index.js";
import type { ConfigError, SecretError } from "../core/index.js";

export const CONFIG_DIR_NAME = ".msg-agent";
export const CONFIG_FILE_NAME = "config.json";
export const CONFIG_FILE_MODE = 0o600;
export const CONFIG_DIR_MODE = 0o700;
/** Only these keys are read from a .env file — SDK control variables (base URLs, log levels) are never imported. */
export const DOTENV_ALLOWED_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
] as const;

export type EnvSource = Readonly<Record<string, string | undefined>>;

export function defaultConfigPath(home: string = homedir()): string {
  return join(home, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

/** Error names only — never the message, which may quote file content. */
function errorName(e: unknown): string {
  return e instanceof Error ? e.name : "unknown";
}

/** Rejects symlinks, non-regular files, and group/other-readable files. */
function checkSecure(path: string): ConfigError | undefined {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return { kind: "unreadable", path, detail: "symlink" };
  if (!st.isFile()) return { kind: "unreadable", path, detail: "not_regular_file" };
  if ((st.mode & 0o077) !== 0) return { kind: "unreadable", path, detail: "insecure_permissions" };
  return undefined;
}

/** Loads and validates the config file. Never logs or echoes its contents. */
export function loadConfig(path: string = defaultConfigPath()): Result<Config, ConfigError> {
  if (!existsSync(path)) return err({ kind: "not_found", path });
  let raw: string;
  try {
    const insecure = checkSecure(path);
    if (insecure !== undefined) return err(insecure);
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return err({ kind: "unreadable", path, detail: errorName(e) });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // JSON.parse messages quote the input — which holds secrets — so only a fixed code is kept.
    return err({ kind: "invalid_json", path, detail: "syntax" });
  }
  const parsed = parseConfig(json);
  if (!parsed.ok) return err({ kind: "invalid", path, issues: parsed.error });
  return ok(parsed.value);
}

/**
 * Validates and writes the config atomically: a fresh temp file (mode 600, exclusive create) in the same
 * directory, then rename over the target. A failure at any point leaves the previous file untouched.
 */
export function saveConfig(
  input: ConfigInput,
  path: string = defaultConfigPath(),
): Result<Config, ConfigError> {
  const parsed = parseConfig(input);
  if (!parsed.ok) return err({ kind: "invalid", path, issues: parsed.error });
  const dir = dirname(path);
  const tmp = join(
    dir,
    `.${CONFIG_FILE_NAME}.${String(process.pid)}.${Date.now().toString(36)}.tmp`,
  );
  try {
    mkdirSync(dir, { recursive: true, mode: CONFIG_DIR_MODE });
    if (existsSync(path)) {
      const st = lstatSync(path);
      if (st.isSymbolicLink() || !st.isFile())
        return err({ kind: "unreadable", path, detail: "symlink" });
    }
    writeFileSync(tmp, `${JSON.stringify(parsed.value, null, 2)}\n`, {
      encoding: "utf8",
      mode: CONFIG_FILE_MODE,
      flag: "wx",
    });
    renameSync(tmp, path);
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    return err({ kind: "unreadable", path, detail: errorName(e) });
  }
  return ok(parsed.value);
}

/** Octal permission bits of the config file, for `status` and tests. */
export function configFileMode(path: string = defaultConfigPath()): number | undefined {
  if (!existsSync(path)) return undefined;
  return lstatSync(path).mode & 0o777;
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
 * Loads only the allow-listed keys from `<cwd>/.env` into process.env (existing values win).
 * Everything else in the file — including SDK control variables — is ignored. Returns whether a file was read.
 */
export function loadDotEnv(cwd: string = process.cwd()): boolean {
  const path = join(cwd, ".env");
  if (!existsSync(path)) return false;
  let parsed: Readonly<Record<string, string | undefined>>;
  try {
    parsed = parseEnv(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  for (const key of DOTENV_ALLOWED_KEYS) {
    const v = parsed[key];
    if (v !== undefined && process.env[key] === undefined) process.env[key] = v;
  }
  return true;
}
