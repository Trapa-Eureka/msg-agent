import { describe, expect, it, vi } from "vitest";
import { ClaudeProvider, OpenAIProvider, createProvider } from "../src/adapters/providers/index.js";
import { supportsFallbacks } from "../src/adapters/providers/claude.js";
import { ProviderError } from "../src/core/index.js";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch double that records requests and replays canned responses in order. */
function mockFetch(responses: { status: number; body: unknown }[]): {
  fetch: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const h = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    h.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const raw = init?.body;
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined,
    });
    const next = responses[calls.length - 1] ?? {
      status: 500,
      body: { error: "no canned response" },
    };
    return Promise.resolve(
      new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch: fetchImpl, calls };
}

const claudeMessage = (text: string, stop = "end_turn"): unknown => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5",
  content: [{ type: "text", text }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});
const chunks = [
  { index: 0, sectionIndex: 0, text: "Hello" },
  { index: 1, sectionIndex: 0, text: "World" },
];

describe("ClaudeProvider (SDK + injected fetch)", () => {
  it("sends one Messages request per chunk with the expected shape and headers", async () => {
    const m = mockFetch([
      { status: 200, body: claudeMessage("안녕") },
      { status: 200, body: claudeMessage("세계") },
    ]);
    const p = new ClaudeProvider({ apiKey: "sk-test", fetch: m.fetch, maxRetries: 0 });
    const progress: number[] = [];
    const out = await p.translate(chunks, "ko", {
      sourceLangHint: "en",
      onProgress: (d) => progress.push(d),
    });

    expect(out).toEqual([
      { index: 0, text: "안녕" },
      { index: 1, text: "세계" },
    ]);
    expect(progress).toEqual([1, 2]);
    expect(m.calls).toHaveLength(2);
    const c = m.calls[0];
    if (c === undefined) throw new Error("no request captured");
    expect(c.url).toBe("https://api.anthropic.com/v1/messages");
    expect(c.method).toBe("POST");
    expect(c.headers["x-api-key"]).toBe("sk-test");
    expect(c.headers["anthropic-beta"]).toBeUndefined();
    expect(c.body).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(c.body).not.toHaveProperty("fallbacks"); // Sonnet 5 rejects the parameter with 400
    const body = c.body as { system: string };
    expect(body.system).toContain("Korean (ko)");
    expect(body.system).toContain("English (en)");
    expect(body).not.toHaveProperty("thinking");
  });

  it("enables server-side fallbacks only on Opus 5 / Fable 5 models", async () => {
    const m = mockFetch([{ status: 200, body: claudeMessage("x") }]);
    const p = new ClaudeProvider({
      apiKey: "k",
      model: "claude-opus-5",
      fetch: m.fetch,
      maxRetries: 0,
    });
    await p.summarize({ text: "body", sections: [] }, "ko");
    expect(m.calls[0]?.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(m.calls[0]?.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(m.calls[0]?.body).toMatchObject({ fallbacks: "default" });
    expect(supportsFallbacks("claude-fable-5-1")).toBe(true);
    expect(supportsFallbacks("claude-sonnet-5")).toBe(false);
    expect(supportsFallbacks("claude-haiku-4-5")).toBe(false);
  });

  it("does not let the SDK retry: one HTTP request per attempt by default (review 07)", async () => {
    const m = mockFetch([
      { status: 529, body: { type: "error", error: { type: "overloaded_error", message: "x" } } },
      { status: 529, body: { type: "error", error: { type: "overloaded_error", message: "x" } } },
    ]);
    const p = new ClaudeProvider({ apiKey: "k", fetch: m.fetch }); // no maxRetries given
    await expect(p.translate(chunks.slice(0, 1), "ko", {})).rejects.toMatchObject({
      kind: "server",
    });
    expect(m.calls).toHaveLength(1);
  });

  it("pins the official base URL and keeps SDK logging off regardless of the environment (SEC-04/05)", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://review-sink.invalid";
    process.env.ANTHROPIC_LOG = "debug";
    const logs: string[] = [];
    const spyErr = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
    const spyLog = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
    try {
      const m = mockFetch([{ status: 400, body: "SIGNATURE-IN-ERROR-BODY not json" }]);
      const p = new ClaudeProvider({ apiKey: "k", fetch: m.fetch });
      await expect(p.summarize({ text: "t", sections: [] }, "ko")).rejects.toBeInstanceOf(
        ProviderError,
      );
      expect(m.calls[0]?.url.startsWith("https://api.anthropic.com/")).toBe(true);
      expect(logs.join("\n")).not.toContain("SIGNATURE-IN-ERROR-BODY");
      expect(logs.join("\n")).not.toContain("review-sink");
    } finally {
      spyErr.mockRestore();
      spyLog.mockRestore();
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_LOG;
    }
  });

  it("uses the configured model and medium effort for summaries", async () => {
    const m = mockFetch([{ status: 200, body: claudeMessage("- 요약") }]);
    const p = new ClaudeProvider({
      apiKey: "k",
      model: "claude-opus-5",
      fetch: m.fetch,
      maxRetries: 0,
    });
    expect(await p.summarize({ text: "body", sections: [] }, "ko")).toBe("- 요약");
    expect(m.calls[0]?.body).toMatchObject({
      model: "claude-opus-5",
      output_config: { effort: "medium" },
    });
  });

  it("maps auth, rate limit, server, and refusal outcomes to ProviderError", async () => {
    const cases: { status: number; body: unknown; kind: string; retryable: boolean }[] = [
      {
        status: 401,
        body: { type: "error", error: { type: "authentication_error", message: "x" } },
        kind: "auth",
        retryable: false,
      },
      {
        status: 429,
        body: { type: "error", error: { type: "rate_limit_error", message: "x" } },
        kind: "rate_limit",
        retryable: true,
      },
      {
        status: 529,
        body: { type: "error", error: { type: "overloaded_error", message: "x" } },
        kind: "server",
        retryable: true,
      },
      { status: 200, body: claudeMessage("", "refusal"), kind: "refusal", retryable: false },
    ];
    for (const c of cases) {
      const m = mockFetch([{ status: c.status, body: c.body }]);
      const p = new ClaudeProvider({ apiKey: "k", fetch: m.fetch, maxRetries: 0 });
      const e = await p.translate(chunks.slice(0, 1), "ko", {}).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect(e).toMatchObject({ kind: c.kind, retryable: c.retryable });
      expect(JSON.stringify(e)).not.toContain("Hello"); // never echoes content
    }
  });

  it("verify hits GET /v1/models/{model} and spends no tokens", async () => {
    const ok = mockFetch([
      {
        status: 200,
        body: {
          id: "claude-sonnet-5",
          type: "model",
          display_name: "x",
          created_at: "2026-01-01T00:00:00Z",
        },
      },
    ]);
    const p = new ClaudeProvider({ apiKey: "k", fetch: ok.fetch, maxRetries: 0 });
    expect(await p.verify()).toEqual({ ok: true, value: undefined });
    expect(ok.calls[0]).toMatchObject({
      method: "GET",
      url: "https://api.anthropic.com/v1/models/claude-sonnet-5",
    });

    const bad = mockFetch([
      {
        status: 401,
        body: { type: "error", error: { type: "authentication_error", message: "x" } },
      },
    ]);
    const r = await new ClaudeProvider({ apiKey: "k", fetch: bad.fetch, maxRetries: 0 }).verify();
    expect(!r.ok && r.error.kind).toBe("auth");

    const missing = mockFetch([
      { status: 404, body: { type: "error", error: { type: "not_found_error", message: "x" } } },
    ]);
    const r2 = await new ClaudeProvider({
      apiKey: "k",
      model: "nope",
      fetch: missing.fetch,
      maxRetries: 0,
    }).verify();
    expect(!r2.ok && r2.error.detail).toBe("model_not_found");
  });
});

describe("OpenAIProvider (raw fetch)", () => {
  const completion = (content: string, finish = "stop"): unknown => ({
    choices: [{ message: { role: "assistant", content }, finish_reason: finish }],
  });

  it("posts chat completions with bearer auth and system/user messages", async () => {
    const m = mockFetch([
      { status: 200, body: completion("안녕") },
      { status: 200, body: completion("세계") },
    ]);
    const p = new OpenAIProvider({ apiKey: "sk-o", fetch: m.fetch });
    const out = await p.translate(chunks, "ko", {});
    expect(out.map((c) => c.text)).toEqual(["안녕", "세계"]);
    const c = m.calls[0];
    if (c === undefined) throw new Error("no request captured");
    expect(c.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(c.headers.authorization).toBe("Bearer sk-o");
    expect(c.headers["content-type"]).toBe("application/json");
    expect(c.body).toMatchObject({
      model: "gpt-5",
      max_completion_tokens: 16000,
      messages: [{ role: "system" }, { role: "user", content: "Hello" }],
    });
  });

  it("maps HTTP statuses, content filters, and empty replies", async () => {
    const cases: { status: number; body: unknown; kind: string; retryable: boolean }[] = [
      { status: 401, body: {}, kind: "auth", retryable: false },
      { status: 429, body: {}, kind: "rate_limit", retryable: true },
      { status: 503, body: {}, kind: "server", retryable: true },
      { status: 200, body: completion("x", "content_filter"), kind: "refusal", retryable: false },
      { status: 200, body: completion(""), kind: "bad_response", retryable: true },
    ];
    for (const c of cases) {
      const m = mockFetch([{ status: c.status, body: c.body }]);
      const e = await new OpenAIProvider({ apiKey: "k", fetch: m.fetch })
        .summarize({ text: "t", sections: [] }, "ko")
        .catch((x: unknown) => x);
      expect(e).toMatchObject({ kind: c.kind, retryable: c.retryable });
    }
  });

  it("turns malformed 200 responses into bad_response instead of TypeError (review 14 / SEC-12)", async () => {
    for (const body of [
      null,
      {},
      { choices: [] },
      { choices: [{ message: { content: 42 } }] },
      "just a string",
    ]) {
      const m = mockFetch([{ status: 200, body }]);
      const e = await new OpenAIProvider({ apiKey: "k", fetch: m.fetch })
        .summarize({ text: "t", sections: [] }, "ko")
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect(e).toMatchObject({ kind: "bad_response", retryable: true });
    }
  });

  it("aborts requests that exceed the timeout as a retryable network error (review 06 / SEC-09)", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error("aborted"));
        });
      });
    const p = new OpenAIProvider({ apiKey: "k", fetch: hanging, timeoutMs: 20 });
    const e = await p.translate(chunks.slice(0, 1), "ko", {}).catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: "network", retryable: true, detail: "timeout" });
  });

  it("wraps network failures as retryable and verifies via GET /models/{model}", async () => {
    const failing: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    const e = await new OpenAIProvider({ apiKey: "k", fetch: failing })
      .translate(chunks, "ko", {})
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: "network", retryable: true });

    const m = mockFetch([{ status: 200, body: { id: "gpt-5" } }]);
    const p = new OpenAIProvider({
      apiKey: "k",
      fetch: m.fetch,
      baseUrl: "https://proxy.local/v1/",
    });
    expect(await p.verify()).toEqual({ ok: true, value: undefined });
    expect(m.calls[0]).toMatchObject({ method: "GET", url: "https://proxy.local/v1/models/gpt-5" });
  });
});

describe("createProvider", () => {
  it("builds the provider named in config with the optional model", () => {
    const f = mockFetch([]).fetch;
    expect(createProvider({ kind: "claude", apiKeyRef: "env:X" }, "k", f)).toBeInstanceOf(
      ClaudeProvider,
    );
    const o = createProvider({ kind: "openai", apiKeyRef: "env:X", model: "gpt-5-mini" }, "k", f);
    expect(o).toBeInstanceOf(OpenAIProvider);
    expect((o as OpenAIProvider).model).toBe("gpt-5-mini");
  });
});
