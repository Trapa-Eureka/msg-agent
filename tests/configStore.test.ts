import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configFileMode,
  defaultConfigPath,
  loadConfig,
  loadDotEnv,
  resolveSecret,
  saveConfig,
} from "../src/adapters/configStore.js";
import { explainConfigError, explainSecretError } from "../src/core/configMessages.js";

const input = {
  nativeLang: "ko",
  provider: { kind: "claude", apiKeyRef: "env:ANTHROPIC_API_KEY" },
  messenger: { kind: "telegram", tokenRef: "literal:123:abc" },
} as const;

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "message-config-"));
  path = join(dir, ".msg-agent", "config.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("configStore", () => {
  it("defaults to ~/.msg-agent/config.json", () => {
    expect(defaultConfigPath("/home/u")).toBe("/home/u/.msg-agent/config.json");
  });

  it("round-trips a config with defaults applied and mode 600 / dir 700", () => {
    const saved = saveConfig(input, path);
    expect(saved.ok).toBe(true);
    expect(configFileMode(path)).toBe(0o600);
    expect(statSync(join(dir, ".msg-agent")).mode & 0o777).toBe(0o700);

    const loaded = loadConfig(path);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toEqual({
      ...input,
      mode: "smart",
      inlineThresholdChars: 3000,
      maxChars: 120000,
      access: { allowedChatIds: [] },
    });
  });

  it("tightens permissions of a pre-existing loose file", () => {
    writeFileSync(path.replace("/.msg-agent/config.json", "/loose.json"), "{}", { mode: 0o644 });
    const loose = join(dir, "loose.json");
    expect(statSync(loose).mode & 0o777).toBe(0o644);
    expect(saveConfig(input, loose).ok).toBe(true);
    expect(statSync(loose).mode & 0o777).toBe(0o600);
  });

  it("refuses to save invalid input and writes nothing", () => {
    const r = saveConfig({ ...input, nativeLang: "Korean" }, path);
    expect(r.ok).toBe(false);
    expect(configFileMode(path)).toBeUndefined();
  });

  it("reports a missing file with an init hint", () => {
    const r = loadConfig(path);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("not_found");
    const [e] = explainConfigError(r.error, "ko");
    expect(e?.fix).toContain("init");
  });

  it("reports invalid JSON", () => {
    saveConfig(input, path);
    writeFileSync(path, "{ not json");
    const r = loadConfig(path);
    expect(!r.ok && r.error.kind).toBe("invalid_json");
  });

  it("reports schema issues from a hand-edited file", () => {
    saveConfig(input, path);
    const obj: Record<string, unknown> = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    obj.mode = "loud";
    writeFileSync(path, JSON.stringify(obj));
    const r = loadConfig(path);
    expect(r.ok).toBe(false);
    if (r.ok || r.error.kind !== "invalid") return;
    expect(r.error.issues).toEqual([{ code: "invalid_mode", path: "mode", detail: "loud" }]);
    expect(explainConfigError(r.error, "en")[0]?.fix).toContain("smart");
  });
});

describe("resolveSecret", () => {
  it("reads env refs from the given env source only", () => {
    const r = resolveSecret("env:MY_KEY", "provider.apiKeyRef", { MY_KEY: "v" });
    expect(r).toEqual({ ok: true, value: "v" });
  });

  it("returns literal values", () => {
    expect(resolveSecret("literal:tok:en", "messenger.tokenRef", {})).toEqual({
      ok: true,
      value: "tok:en",
    });
  });

  it("explains a missing env var with the variable name and a .env fix", () => {
    const r = resolveSecret("env:MISSING_KEY", "provider.apiKeyRef", {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({
      kind: "env_missing",
      field: "provider.apiKeyRef",
      varName: "MISSING_KEY",
    });
    const e = explainSecretError(r.error, "ko");
    expect(e.fix).toContain("MISSING_KEY=");
    expect(e.fix).toContain(".env");
  });

  it("treats empty values as errors", () => {
    expect(resolveSecret("env:E", "f", { E: "  " })).toEqual({
      ok: false,
      error: { kind: "empty", field: "f" },
    });
  });

  it("flags malformed refs", () => {
    expect(resolveSecret("plain", "f", {})).toEqual({
      ok: false,
      error: { kind: "malformed_ref", field: "f" },
    });
  });
});

describe("loadDotEnv", () => {
  it("returns false when no .env exists", () => {
    expect(loadDotEnv(dir)).toBe(false);
  });

  it("loads variables without overriding existing ones", () => {
    process.env.MESSAGE_TEST_FIXED = "keep";
    writeFileSync(join(dir, ".env"), "MESSAGE_TEST_NEW=from-file\nMESSAGE_TEST_FIXED=override\n");
    try {
      expect(loadDotEnv(dir)).toBe(true);
      expect(process.env.MESSAGE_TEST_NEW).toBe("from-file");
      expect(process.env.MESSAGE_TEST_FIXED).toBe("keep");
    } finally {
      delete process.env.MESSAGE_TEST_NEW;
      delete process.env.MESSAGE_TEST_FIXED;
    }
  });
});
