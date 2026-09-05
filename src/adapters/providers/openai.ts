// OpenAI provider — Chat Completions over injected fetch (tests use a mock fetch; no network).
import { z } from "zod";
import type {
  Chunk,
  ExtractedDoc,
  Result,
  TranslateOptions,
  TranslatedChunk,
  TranslatorProvider,
} from "../../core/index.js";
import { ProviderError, err, ok, summaryPrompt, translationPrompt } from "../../core/index.js";

export const OPENAI_DEFAULT_MODEL = "gpt-5";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_COMPLETION_TOKENS = 16000;

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

const OPENAI_TIMEOUT_MS = 90_000;
/** Boundary schema — anything else is a `bad_response`, never a TypeError (review 14 / SEC-12). */
const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }).optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

function statusToError(status: number, detail: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("auth", false, status, detail);
  if (status === 429) return new ProviderError("rate_limit", true, status, detail);
  if (status >= 500) return new ProviderError("server", true, status, detail);
  return new ProviderError("unknown", false, status, detail);
}

export class OpenAIProvider implements TranslatorProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  readonly model: string;

  constructor(opts: OpenAIProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? OPENAI_DEFAULT_MODEL;
    this.fetchImpl = opts.fetch ?? fetch;
    this.baseUrl = (opts.baseUrl ?? OPENAI_BASE_URL).replace(/\/$/u, "");
    this.timeoutMs = opts.timeoutMs ?? OPENAI_TIMEOUT_MS;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new ProviderError(
        "network",
        true,
        undefined,
        timedOut ? "timeout" : e instanceof Error ? e.name : "fetch_failed",
      );
    }
  }

  private async complete(system: string, user: string): Promise<string> {
    const res = await this.request("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw statusToError(res.status, `http_${String(res.status)}`);
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new ProviderError("bad_response", true, res.status, "invalid_json");
    }
    const body = completionSchema.safeParse(raw);
    if (!body.success) throw new ProviderError("bad_response", true, res.status, "schema");
    const choice = body.data.choices[0];
    const text = choice?.message?.content?.trim() ?? "";
    if (choice?.finish_reason === "content_filter")
      throw new ProviderError("refusal", false, res.status, "content_filter");
    if (text === "") throw new ProviderError("bad_response", true, res.status, "empty_text");
    if (choice?.finish_reason === "length")
      throw new ProviderError("bad_response", false, res.status, "length");
    return text;
  }

  async translate(chunks: Chunk[], to: string, opts: TranslateOptions): Promise<TranslatedChunk[]> {
    const out: TranslatedChunk[] = [];
    for (const chunk of chunks) {
      const p = translationPrompt(chunk.text, to, opts.sourceLangHint);
      const text = await this.complete(p.system, p.user);
      out.push({ index: chunk.index, text });
      opts.onProgress?.(out.length, chunks.length);
    }
    return out;
  }

  async summarize(doc: ExtractedDoc, to: string): Promise<string> {
    const p = summaryPrompt(doc, to);
    return this.complete(p.system, p.user);
  }

  async verify(): Promise<Result<void, ProviderError>> {
    let res: Response;
    try {
      res = await this.request(`/models/${encodeURIComponent(this.model)}`, { method: "GET" });
    } catch (e) {
      return err(e instanceof ProviderError ? e : new ProviderError("unknown", false));
    }
    if (res.ok) return ok(undefined);
    if (res.status === 404)
      return err(new ProviderError("bad_response", false, 404, "model_not_found"));
    return err(statusToError(res.status, `http_${String(res.status)}`));
  }
}
