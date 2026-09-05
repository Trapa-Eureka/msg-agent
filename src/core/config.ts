// Config schema — DESIGN §6. Parsed at the boundary with zod; the rest of the core trusts `Config`.
import { z } from "zod";
import { canonicalLangCode } from "./lang.js";
import type { OutputMode } from "./types.js";
import type { Result } from "./result.js";
import { err, ok } from "./result.js";

// ---- SecretRef: "env:<VAR>" | "literal:<value>" (DESIGN §6) ----

export type SecretRef = `env:${string}` | `literal:${string}`;
export type ParsedSecretRef = { kind: "env"; varName: string } | { kind: "literal"; value: string };

const ENV_REF = /^env:([A-Z_][A-Z0-9_]*)$/;
const LITERAL_PREFIX = "literal:";

export function parseSecretRef(ref: string): ParsedSecretRef | undefined {
  const env = ENV_REF.exec(ref);
  const varName = env?.[1];
  if (varName !== undefined) return { kind: "env", varName };
  if (ref.startsWith(LITERAL_PREFIX) && ref.length > LITERAL_PREFIX.length) {
    return { kind: "literal", value: ref.slice(LITERAL_PREFIX.length) };
  }
  return undefined;
}

/** Display form that never reveals a secret: "env:NAME" stays, literals become "literal:****". */
export function redactSecretRef(ref: string): string {
  const parsed = parseSecretRef(ref);
  if (parsed?.kind === "env") return `env:${parsed.varName}`;
  if (parsed?.kind === "literal") return "literal:****";
  return "(invalid ref)";
}

export function envSecretRef(varName: string): SecretRef {
  return `env:${varName}`;
}

export function literalSecretRef(value: string): SecretRef {
  return `literal:${value}`;
}

// ---- Schema ----

export const OUTPUT_MODES = ["smart", "full", "summary"] as const satisfies readonly OutputMode[];
export const PROVIDER_KINDS = ["claude", "openai"] as const;
export const MESSENGER_KINDS = ["telegram"] as const;

export const DEFAULT_INLINE_THRESHOLD_CHARS = 3000;
export const DEFAULT_MAX_CHARS = 120_000;

const secretRefSchema = z
  .string()
  .refine((v) => parseSecretRef(v) !== undefined, { message: "invalid_secret_ref" });

const langCodeSchema = z.string().transform((value, ctx) => {
  const info = canonicalLangCode(value);
  if (info === undefined) {
    ctx.addIssue({ code: "custom", message: "invalid_lang", input: value });
    return z.NEVER;
  }
  return info.code;
});

export const accessSchema = z.strictObject({
  /** Telegram user id of the owner — set only by pairing (/start <code>). */
  ownerUserId: z.string().min(1).optional(),
  /** Chats allowed to submit documents; the pairing chat plus owner /allow. */
  allowedChatIds: z.array(z.string().min(1)).default([]),
});
export type Access = z.output<typeof accessSchema>;

export const DEFAULT_DOCS_PER_CHAT_PER_HOUR = 20;
export const DEFAULT_DAILY_CHARS = 1_000_000;
/** Rate and budget limits (R2) — counters live in memory, metadata only. */
export const limitsSchema = z.strictObject({
  docsPerChatPerHour: z.int().positive().default(DEFAULT_DOCS_PER_CHAT_PER_HOUR),
  dailyChars: z.int().positive().default(DEFAULT_DAILY_CHARS),
});
export type Limits = z.output<typeof limitsSchema>;

export const configSchema = z
  .strictObject({
    nativeLang: langCodeSchema,
    provider: z.strictObject({
      kind: z.enum(PROVIDER_KINDS),
      apiKeyRef: secretRefSchema,
      model: z.string().min(1).optional(),
    }),
    messenger: z.strictObject({
      kind: z.enum(MESSENGER_KINDS),
      tokenRef: secretRefSchema,
    }),
    mode: z.enum(OUTPUT_MODES).default("smart"),
    inlineThresholdChars: z.int().positive().default(DEFAULT_INLINE_THRESHOLD_CHARS),
    maxChars: z.int().positive().default(DEFAULT_MAX_CHARS),
    access: accessSchema.default({ allowedChatIds: [] }),
    limits: limitsSchema.default({
      docsPerChatPerHour: DEFAULT_DOCS_PER_CHAT_PER_HOUR,
      dailyChars: DEFAULT_DAILY_CHARS,
    }),
  })
  .refine((c) => c.inlineThresholdChars <= c.maxChars, {
    message: "threshold_over_max",
    path: ["inlineThresholdChars"],
  });

export type Config = z.output<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

// ---- Issues (codes only; wording lives in configMessages / the T8 phrase pack) ----

export type ConfigIssueCode =
  | "missing_field"
  | "invalid_lang"
  | "invalid_secret_ref"
  | "invalid_mode"
  | "invalid_kind"
  | "invalid_number"
  | "threshold_over_max"
  | "invalid_value";

export interface ConfigIssue {
  code: ConfigIssueCode;
  /** Dotted path, e.g. "provider.apiKeyRef". */
  path: string;
  /** Extra detail safe to show (never a secret). */
  detail?: string;
}

function classify(issue: z.core.$ZodIssue): ConfigIssue {
  const path = issue.path.map(String).join(".");
  const leaf = issue.path[issue.path.length - 1];
  if (issue.code === "invalid_type" && issue.input === undefined) {
    return { code: "missing_field", path };
  }
  if (issue.code === "unrecognized_keys") {
    return { code: "invalid_value", path, detail: `unknown key: ${issue.keys.join(", ")}` };
  }
  if (issue.message === "invalid_lang") {
    return { code: "invalid_lang", path, detail: String(issue.input) };
  }
  if (issue.message === "invalid_secret_ref") return { code: "invalid_secret_ref", path };
  if (issue.message === "threshold_over_max") return { code: "threshold_over_max", path };
  if (leaf === "mode") return { code: "invalid_mode", path, detail: String(issue.input) };
  if (leaf === "kind") return { code: "invalid_kind", path, detail: String(issue.input) };
  if (leaf === "inlineThresholdChars" || leaf === "maxChars") {
    return { code: "invalid_number", path, detail: String(issue.input) };
  }
  return { code: "invalid_value", path, detail: issue.message };
}

/** Parses untrusted input (config file contents) into a Config or a list of issues. */
export function parseConfig(input: unknown): Result<Config, ConfigIssue[]> {
  const result = configSchema.safeParse(input, { reportInput: true });
  if (result.success) return ok(result.data);
  return err(result.error.issues.map(classify));
}
