import type { Config, TranslatorProvider } from "../../core/index.js";
import { ClaudeProvider } from "./claude.js";
import { OpenAIProvider } from "./openai.js";

export { ClaudeProvider, CLAUDE_DEFAULT_MODEL } from "./claude.js";
export { OpenAIProvider, OPENAI_DEFAULT_MODEL, OPENAI_BASE_URL } from "./openai.js";

/** Builds the configured provider. `apiKey` is the already-resolved secret (configStore.resolveSecret). */
export function createProvider(
  provider: Config["provider"],
  apiKey: string,
  fetchImpl?: typeof fetch,
): TranslatorProvider {
  const model = provider.model;
  const common = {
    apiKey,
    ...(model === undefined ? {} : { model }),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  };
  switch (provider.kind) {
    case "claude":
      return new ClaudeProvider(common);
    case "openai":
      return new OpenAIProvider(common);
  }
}
