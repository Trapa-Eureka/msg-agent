// Claude provider — official SDK with injected fetch (tests use a mock fetch; no network).
import Anthropic from "@anthropic-ai/sdk";
import type {
  Chunk,
  ExtractedDoc,
  Result,
  TranslateOptions,
  TranslatedChunk,
  TranslatorProvider,
} from "../../core/index.js";
import { ProviderError, err, ok, summaryPrompt, translationPrompt } from "../../core/index.js";

export const CLAUDE_DEFAULT_MODEL = "claude-sonnet-5";
export const CLAUDE_BASE_URL = "https://api.anthropic.com";
const MAX_TOKENS = 16000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Server-side refusal fallbacks exist only on the Opus 5 / Fable 5 families; Sonnet 5 rejects the parameter. */
const FALLBACK_MODELS = /^claude-(?:opus-5|fable-5)/u;
export function supportsFallbacks(model: string): boolean {
  return FALLBACK_MODELS.test(model);
}

export interface ClaudeProviderOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  maxRetries?: number;
}

function numericStatus(status: unknown): number | undefined {
  return typeof status === "number" ? status : undefined;
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("auth", false, e.status, e.name);
  }
  if (e instanceof Anthropic.RateLimitError)
    return new ProviderError("rate_limit", true, e.status, e.name);
  if (e instanceof Anthropic.InternalServerError) {
    return new ProviderError("server", true, numericStatus(e.status), e.name);
  }
  if (e instanceof Anthropic.APIConnectionError)
    return new ProviderError("network", true, undefined, e.name);
  if (e instanceof Anthropic.APIError) {
    return new ProviderError("unknown", false, numericStatus(e.status), e.constructor.name);
  }
  return new ProviderError("unknown", false, undefined, e instanceof Error ? e.name : "unknown");
}

export class ClaudeProvider implements TranslatorProvider {
  private readonly client: Anthropic;
  readonly model: string;

  constructor(opts: ClaudeProviderOptions) {
    this.model = opts.model ?? CLAUDE_DEFAULT_MODEL;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      // R3: never let the environment redirect requests or turn on SDK debug logging (bodies could be logged).
      baseURL: CLAUDE_BASE_URL,
      logLevel: "off",
      ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
      // Retries belong to the pipeline (one per chunk); the SDK must not add its own (R2 / review 07).
      maxRetries: opts.maxRetries ?? 0,
    });
  }

  private async complete(system: string, user: string, effort: "low" | "medium"): Promise<string> {
    let response: Anthropic.Beta.BetaMessage | Anthropic.Message;
    const request = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      output_config: { effort },
      system,
      messages: [{ role: "user" as const, content: user }],
    };
    try {
      response = supportsFallbacks(this.model)
        ? await this.client.beta.messages.create({
            ...request,
            betas: [FALLBACK_BETA],
            fallbacks: "default",
          })
        : await this.client.messages.create(request);
    } catch (e) {
      throw toProviderError(e);
    }
    if (response.stop_reason === "refusal")
      throw new ProviderError("refusal", false, undefined, "refusal");
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock | Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (text === "") throw new ProviderError("bad_response", true, undefined, "empty_text");
    if (response.stop_reason === "max_tokens")
      throw new ProviderError("bad_response", false, undefined, "max_tokens");
    return text;
  }

  async translate(chunks: Chunk[], to: string, opts: TranslateOptions): Promise<TranslatedChunk[]> {
    const out: TranslatedChunk[] = [];
    for (const chunk of chunks) {
      const p = translationPrompt(chunk.text, to, opts.sourceLangHint);
      const text = await this.complete(p.system, p.user, "low");
      out.push({ index: chunk.index, text });
      opts.onProgress?.(out.length, chunks.length);
    }
    return out;
  }

  async summarize(doc: ExtractedDoc, to: string): Promise<string> {
    const p = summaryPrompt(doc, to);
    return this.complete(p.system, p.user, "medium");
  }

  async verify(): Promise<Result<void, ProviderError>> {
    try {
      await this.client.models.retrieve(this.model);
      return ok(undefined);
    } catch (e) {
      const pe = toProviderError(e);
      if (e instanceof Anthropic.NotFoundError)
        return err(new ProviderError("bad_response", false, 404, "model_not_found"));
      return err(pe);
    }
  }
}
