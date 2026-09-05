// Status: config summary (secrets redacted) + bot connectivity.
import {
  canonicalLangCode,
  explainConfigError,
  formatExplanations,
  redactSecretRef,
} from "../core/index.js";
import type { EnvSource } from "../adapters/configStore.js";
import { configFileMode, loadConfig, resolveSecret } from "../adapters/configStore.js";
import { text, uiLangFor } from "./text.js";

export interface StatusDeps {
  configPath: string;
  env: EnvSource;
  out: (line: string) => void;
  /** Returns the bot username, or undefined when unreachable. */
  checkBot: (token: string) => Promise<string | undefined>;
}

export async function runStatus(d: StatusDeps): Promise<number> {
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
  const c = loaded.value;
  const mode = configFileMode(d.configPath);
  d.out(t.statusTitle);
  d.out(`config: ${d.configPath} (mode ${mode === undefined ? "?" : mode.toString(8)})`);
  d.out(`nativeLang: ${c.nativeLang} (${canonicalLangCode(c.nativeLang)?.name ?? "?"})`);
  d.out(
    `provider: ${c.provider.kind}${c.provider.model === undefined ? "" : ` / ${c.provider.model}`} — key ${redactSecretRef(c.provider.apiKeyRef)}`,
  );
  d.out(`messenger: ${c.messenger.kind} — token ${redactSecretRef(c.messenger.tokenRef)}`);
  d.out(
    `mode: ${c.mode}, inlineThresholdChars: ${String(c.inlineThresholdChars)}, maxChars: ${String(c.maxChars)}`,
  );
  d.out(
    `access: owner ${c.access.ownerUserId === undefined ? "(not paired)" : "set"}, allowed chats ${String(c.access.allowedChatIds.length)}`,
  );

  const token = resolveSecret(c.messenger.tokenRef, "messenger.tokenRef", d.env);
  if (!token.ok) {
    d.out(t.botFail);
    return 1;
  }
  const username = await d.checkBot(token.value);
  d.out(username === undefined ? t.botFail : t.botOk(username));
  return username === undefined ? 1 : 0;
}
