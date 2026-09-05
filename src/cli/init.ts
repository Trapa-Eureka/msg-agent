// Onboarding (SPEC §3): native language -> provider + key -> Telegram token. Injected prompts and verifiers.
import { iso6393 } from "iso-639-3";
import type { ConfigInput, Result } from "../core/index.js";
import {
  PROVIDER_KINDS,
  canonicalLangCode,
  envSecretRef,
  explainConfigError,
  explainSecretError,
  formatExplanations,
  literalSecretRef,
} from "../core/index.js";
import type { EnvSource } from "../adapters/configStore.js";
import { saveConfig } from "../adapters/configStore.js";
import { text, uiLangFor } from "./text.js";
import type { UiLang } from "./text.js";

export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type Question =
  | { type: "text" | "password"; message: string }
  | { type: "confirm"; message: string; initial?: boolean }
  | { type: "select"; message: string; choices: readonly { title: string; value: string }[] }
  | { type: "autocomplete"; message: string; choices: readonly { title: string; value: string }[] };
/** Returns the answer, or undefined when the user cancelled. */
export type Asker = (q: Question) => Promise<string | boolean | undefined>;

/** Cause + fix to display, or undefined on success. */
export type VerifyResult =
  { ok: true; detail?: string } | { ok: false; cause: string; fix: string };

export interface InitDeps {
  ask: Asker;
  out: (line: string) => void;
  configPath: string;
  env: EnvSource;
  verifyProvider: (kind: ProviderKind, apiKey: string) => Promise<VerifyResult>;
  verifyTelegram: (token: string) => Promise<VerifyResult>;
  /** Locale hint for the first screen (before the native language is known). */
  uiLang?: UiLang;
  maxAttempts?: number;
}

const ENV_VAR: Record<ProviderKind, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};
const TELEGRAM_ENV = "TELEGRAM_BOT_TOKEN";
const PROVIDER_LABEL: Record<ProviderKind, string> = {
  claude: "Claude (Anthropic)",
  openai: "OpenAI",
};

/** Onboarding offers these ten languages (SPEC §3). Any other ISO 639 code can be set later with /lang. */
export const ONBOARDING_LANGUAGES: readonly { code: string; ko: string; en: string }[] = [
  { code: "ko", ko: "한국어", en: "Korean" },
  { code: "en", ko: "영어", en: "English" },
  { code: "es", ko: "스페인어", en: "Spanish" },
  { code: "fr", ko: "프랑스어", en: "French" },
  { code: "de", ko: "독일어", en: "German" },
  { code: "ja", ko: "일본어", en: "Japanese" },
  { code: "zh", ko: "중국어", en: "Chinese" },
  { code: "it", ko: "이탈리아어", en: "Italian" },
  { code: "ru", ko: "러시아어", en: "Russian" },
  { code: "la", ko: "라틴어", en: "Latin" },
];

export const languageChoices = (): { title: string; value: string }[] =>
  ONBOARDING_LANGUAGES.map((l) => ({ title: `${l.ko} · ${l.en} (${l.code})`, value: l.code }));

/** Resolves a name ("Korean") or code ("ko"/"kor") to a canonical code. */
export function resolveLanguageInput(input: string): string | undefined {
  const byCode = canonicalLangCode(input);
  if (byCode !== undefined) return byCode.code;
  const needle = input.trim().toLowerCase();
  const byName = iso6393.find((l) => l.name.toLowerCase() === needle);
  return byName === undefined ? undefined : canonicalLangCode(byName.iso6393)?.code;
}

type Step<T> = () => Promise<T | undefined>;

/** Runs `step` until it yields a value; prints the retry notice between attempts. */
async function withAttempts<T>(
  step: Step<T>,
  attempts: number,
  notice: (left: number) => string,
  out: (l: string) => void,
): Promise<T | undefined> {
  for (let i = 1; i <= attempts; i++) {
    const v = await step();
    if (v !== undefined) return v;
    if (i < attempts) out(notice(attempts - i));
  }
  return undefined;
}

/** Secret step shared by provider key and bot token: env reference if available, else literal input, then verify. */
async function secretStep(
  d: InitDeps,
  t: ReturnType<typeof text>,
  varName: string,
  askMessage: string,
  verify: (secret: string) => Promise<VerifyResult>,
  onOk: (r: Extract<VerifyResult, { ok: true }>) => void,
): Promise<string | undefined> {
  const attempts = d.maxAttempts ?? 3;
  let envOffered = false;
  return withAttempts<string>(
    async () => {
      let ref: string;
      let secret: string;
      const fromEnv = d.env[varName];
      if (!envOffered && fromEnv !== undefined && fromEnv.trim() !== "") {
        envOffered = true;
        const use = await d.ask({ type: "confirm", message: t.useEnv(varName), initial: true });
        if (use === undefined) return undefined;
        if (use === true) {
          ref = envSecretRef(varName);
          secret = fromEnv;
        } else {
          const typed = await d.ask({ type: "password", message: askMessage });
          if (typeof typed !== "string" || typed.trim() === "") return undefined;
          ref = literalSecretRef(typed.trim());
          secret = typed.trim();
        }
      } else {
        const typed = await d.ask({ type: "password", message: askMessage });
        if (typeof typed !== "string" || typed.trim() === "") return undefined;
        ref = literalSecretRef(typed.trim());
        secret = typed.trim();
      }
      d.out(t.verifying);
      const r = await verify(secret);
      if (!r.ok) {
        d.out(formatExplanations([{ cause: r.cause, fix: r.fix }], d.uiLang ?? "en"));
        return undefined;
      }
      onOk(r);
      return ref;
    },
    attempts,
    t.retry,
    d.out,
  );
}

/** Returns the process exit code. */
export async function runInit(d: InitDeps): Promise<number> {
  let ui: UiLang = d.uiLang ?? uiLangFor(undefined);
  let t = text(ui);
  d.out(t.welcome);

  // 1. Native language — fixed list; the answer must be one of the ten codes
  const nativeLang = await withAttempts<string>(
    async () => {
      const a = await d.ask({ type: "select", message: t.askLang, choices: languageChoices() });
      return typeof a === "string" && ONBOARDING_LANGUAGES.some((l) => l.code === a)
        ? a
        : undefined;
    },
    d.maxAttempts ?? 3,
    t.retry,
    d.out,
  );
  if (nativeLang === undefined) {
    d.out(t.aborted);
    return 1;
  }
  ui = uiLangFor(nativeLang);
  t = text(ui);
  d.uiLang = ui;

  // 2. Provider + key
  const kindAnswer = await d.ask({
    type: "select",
    message: t.askProvider,
    choices: PROVIDER_KINDS.map((k) => ({ title: PROVIDER_LABEL[k], value: k })),
  });
  const kind = PROVIDER_KINDS.find((k) => k === kindAnswer);
  if (kind === undefined) {
    d.out(t.aborted);
    return 1;
  }
  const apiKeyRef = await secretStep(
    d,
    t,
    ENV_VAR[kind],
    t.askKey(PROVIDER_LABEL[kind]),
    (s) => d.verifyProvider(kind, s),
    () => {
      d.out(t.verifyOk);
    },
  );
  if (apiKeyRef === undefined) {
    d.out(t.aborted);
    return 1;
  }

  // 3. Telegram token
  const tokenRef = await secretStep(d, t, TELEGRAM_ENV, t.askToken, d.verifyTelegram, (r) => {
    d.out(r.detail === undefined ? t.verifyOk : t.tokenOk(r.detail));
  });
  if (tokenRef === undefined) {
    d.out(t.aborted);
    return 1;
  }

  // Save
  const input: ConfigInput = {
    nativeLang,
    provider: { kind, apiKeyRef },
    messenger: { kind: "telegram", tokenRef },
  };
  const saved: Result<unknown, unknown> = saveConfig(input, d.configPath);
  if (!saved.ok) {
    const r = saveConfig(input, d.configPath);
    if (!r.ok) d.out(formatExplanations(explainConfigError(r.error, ui), ui));
    d.out(t.aborted);
    return 1;
  }
  d.out(t.saved(d.configPath));
  d.out(t.invite);
  return 0;
}

export { explainSecretError };
