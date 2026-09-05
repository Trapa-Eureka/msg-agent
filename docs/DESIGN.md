# DESIGN — msg-agent v0.1

This document is the source of truth for the implementation. Changes to the pipeline, interfaces or output policy are made here first.

## 1. Architecture

```
Telegram (long polling)                    CLI (init/start/status)
      │ file upload events / commands                │
      ▼                                             ▼
adapters/telegramAdapter (grammY) ──────► core/pipeline.ts
      ▲  post (sendMessage/sendDocument)       │
      │                                        ├ extractors (pdf/docx/txt)
      └────────── execute OutputPlan ◄─────────┤ detector (franc → fallback)
                                               ├ chunker (structure-preserving split)
                                               ├ TranslatorProvider (claude | openai)
                                               └ outputPlanner (smart policy)
```

The core knows nothing about messenger or provider implementations. Events arrive as normalized `IncomingDoc` / `IncomingCommand`, output leaves only as an `OutputPlan`. Failures are returned as `Result<T, E>` (core/result.ts) instead of thrown, so user-facing wording is rendered from the T8 phrase pack.

## 2. Core interfaces (core/types.ts)

```ts
export interface IncomingDoc {
  chatId: string; messageId: string; userId?: string;               // userId = sender (undefined for channel posts etc.)
  fileName: string; mime: string; sizeBytes: number; download(): Promise<Uint8Array>;
}
export interface IncomingCommand { chatId: string; userId?: string; name: "start"|"full"|"summary"|"mode"|"lang"|"allow"|"deny"; arg?: string }

export interface MessengerAdapter {
  onDocument(h: (d: IncomingDoc) => Promise<void>): void;
  onCommand(h: (c: IncomingCommand) => Promise<void>): void;
  postText(chatId: string, text: string, replyTo?: string): Promise<void>;   // splitting to the length limit is the adapter's job
  postFile(chatId: string, name: string, content: Uint8Array, caption?: string): Promise<void>;
  start(): Promise<void>; stop(): Promise<void>;
}

export interface DocumentExtractor { supports(mime: string, name: string): boolean; extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> }
export type ExtractError =
  | { kind: "empty_text" }                 // no text layer (scanned) → point to v0.2 OCR
  | { kind: "encrypted" }                  // password-protected PDF
  | { kind: "corrupt"; detail: string };   // parse failure; detail is a library error name only (never content)
export interface ExtractedDoc { text: string; sections: Section[] }        // heading/paragraph structure kept; text is Markdown-flavoured (`# ` headings, blank-line paragraphs)
export interface Section { title?: string; level?: number; text: string }   // level = heading depth (1–6, default 1) — R6
export interface Chunk { index: number; sectionIndex: number; text: string; sep: string }   // sep = the original separator before this chunk within its section ("\n\n", whitespace, ""); "" for the first chunk — R6
export interface TranslatedChunk { index: number; text: string }           // provider output; order restored by index

export interface LanguageDetector { detect(text: string): { lang: string; confidence: number } }

export interface TranslatorProvider {
  translate(chunks: Chunk[], to: string, opts: { sourceLangHint?: string; onProgress?: (done: number, total: number) => void }): Promise<TranslatedChunk[]>;
  summarize(doc: ExtractedDoc, to: string): Promise<string>;               // structured summary (SPEC §4)
  verify(): Promise<Result<void, ProviderError>>;                          // one key check during init (a models lookup that spends no tokens)
}
export type ProviderError = { kind: "auth"|"rate_limit"|"server"|"network"|"bad_response"|"refusal"|"unknown"; retryable: boolean; status?: number; detail?: string }  // detail is an error name/code only, never content

export type OutputPlan =
  | { kind: "inline_full"; parts: string[] }                               // short document: full text in chat (split when posting)
  | { kind: "summary_plus_file"; summary: string; file: { name: string; content: string } }  // long document, smart/summary: summary + full-text file
  | { kind: "file_full"; note: string; file: { name: string; content: string } }             // long document in full mode or `/full`: short note + full-text file
  | { kind: "skip_same_lang"; note: string }
  | { kind: "reject"; reason: string };                                    // over the caps, unsupported format, etc.
```

## 3. Pipeline (core/pipeline.ts)

1. Receive `IncomingDoc` → size/format guards (unsupported or oversize → `reject` plan, reason in the native language)
2. Post a progress notice → download → extractor routing (`findExtractor`: **first decide by MIME alone**; the extension decides only when no extractor recognizes the MIME — a DOCX-MIME file named `report.pdf` goes to DOCX, R6) → `ExtractedDoc`. Section structuring uses the shared heuristic (`core/sections.ts`: Markdown headings and short single lines without terminal punctuation = headings, blank lines = paragraphs). Parser pre-checks (R4, partial SEC-03 response): DOCX archives must have ≤ 200 ZIP entries and ≤ 60 MB uncompressed before parsing and image conversion is disabled; PDFs must have ≤ 500 pages before text extraction; extraction as a whole has a 60-second deadline (exceeded → `corrupt`/timeout — it cannot stop CPU work itself, so process isolation is v0.2).
3. Language detection — franc (`core/detector.ts`). Samples come from **three regions: head, middle, tail** (700 chars each; short documents use the first 2,000 chars split in halves). Confidence = sample-letter factor (1 at 100 letters) × agreement between samples (all agree 1 / one disagrees 0.6 / fewer 0.4) — a mixed document whose head is in the native language drops below 0.7 and goes to translation instead of being skipped (R6, review item 10). Only at **≥ 0.7** does "detected = native" produce `skip_same_lang`; below it, translate without a `sourceLangHint` and let the prompt detect. Macrolanguage members (arb→ar, cmn→zh, …) are normalized in `core/lang.ts`.
4. `outputPlanner.decidePlan`: decision order = unsupported format → byte cap (before download) → same language (new uploads only) → over `maxChars` (`/full` and `/summary` cannot bypass it; ask to split the file) → `/summary` / `/full` requests → mode × threshold (at or below the threshold = short). The result is a `PlanDecision` (kind and rejection reason only, no content). **The length measure is the normalized extracted text's `length` (whitespace included)** — the same measure as what is sent to the provider (R2; `countChars` is for display). Additional guards (R2): chunk count > `maxChunksPerDoc` (default 50) → reject; per-chat documents + re-runs per hour > `limits.docsPerChatPerHour` → `rateLimited`; global daily characters > `limits.dailyChars` → `dailyBudgetExhausted` (all in-memory counters, metadata only).
5. Full-text path: `chunker` (split section → paragraph → sentence → grapheme cluster, default 4,000 chars per chunk, every chunk carries its section heading at the original `#` level, never crossing a section boundary) → `translate` (progress n/m updates) → `assembleChunks(translated, chunks)` in index order — chunks within a section are joined with their original separator (`Chunk.sep`), sections with a blank line (a missing chunk means nothing is posted) — R6
6. Summary path: `summarize` + the full translation assembled into a .md file. In full mode above the threshold → `file_full` (short note + full-text file, no summary call)
7. Execute the plan through the adapter → discard temporary data immediately (guardrail 1)
8. On failure: one retry per chunk → if it still fails, report whether partial results exist and show a native-language error

**Assembly rules (core/pipeline.ts)**
- Dependency injection: `MessengerAdapter`, `DocumentExtractor[]`, `LanguageDetector`, `TranslatorProvider`, `SettingsStore` (config read/write — file IO lives in an adapter), `phrasesFor(lang) → Phrases` (user phrase pack), `Logger` (metadata only), `Clock`. The core contains no string literals — every user-facing phrase leaves only through a `Phrases` key.
- Phrase packs (`src/phrases/`): the `ko` and `en` packs use `satisfies Phrases`, so a missing key fails compilation. `phrasesFor(lang)` normalizes any ISO 639 spelling, picks the pack and **falls back to en**. Language parameters are codes; each pack renders language names in its own language via `Intl.DisplayNames` (the Korean pack prints the Korean word for "Korean", the English pack prints "Korean"). Phrases carry metadata only (file names, counts, codes).
- Translation calls are **one `translate([chunk])` per chunk**. On failure, retry the same chunk once if `retryable`; if it fails again, post no translation at all and report `translationFailed(done, total)`. Provider calls on the happy path = number of chunks (+ 1 summary). **Retries live in the pipeline only** — the Claude SDK is pinned to `maxRetries: 0`, so at most 2 HTTP requests per chunk (R2).
- Progress notices: once when extraction starts; for translation, `0/m` at the start when there are 2+ chunks and then `n/m` at roughly every quarter (max 4); once when summarization starts.
- Per-chat serialization: documents and commands for the same chatId run in order; different chatIds run concurrently (no mixed progress messages). R5: the number of chats processed at once is capped by `maxConcurrentChats` (default 3), and `drain()` waits for in-flight work. **The adapter must hand events to the pipeline and return immediately** (no awaiting) so polling keeps receiving other chats' updates.
- Posting scope: every post uses the `chatId` of the incoming event (guardrail 2). File name is `<original name>.<native language>.md`.
- Last-document reference: chatId → `IncomingDoc` (a `download()` closure based on the file ID + metadata). Body and translation references are dropped right after the plan executes.

Command handling: `/full` is not a re-processing of the previous document but a **re-run of the last document's `file_full` plan** — for that, a per-chat "last document reference (file ID and metadata only, never content)" is kept in memory (lost on process restart — intended, consistent with guardrail 1).

`/summary` re-runs the last document as `summary_plus_file`. `/mode <smart|full|summary>` and `/lang <code>` validate, save to `SettingsStore` and reply with a confirmation (or guidance on a bad argument). Re-runs download, extract and translate again, so they cost money (accepted in v0.1).

## 4. Telegram adapter notes

- grammY long polling. Document handler: `message:document` → `IncomingDoc` (metadata only). Downloading happens only when `download()` is called: getFile → fetch the file URL. **The adapter itself refuses `download()` above 20 MB** (no getFile call), and the pipeline rejects earlier through the planner's byte guard (defense in depth). R4: the getFile response's `file_size` is checked too, the body is accumulated as a stream and cut off the moment it exceeds the cap (missing or forged metadata), and the body fetch carries `AbortSignal.timeout` (default 60 s). The pipeline re-checks the received byte length.
- `postText` disables link previews with `link_preview_options: { is_disabled: true }` (no incidental external access to URLs coming from the document or the model, SEC-11) and splits to the 4,096-character limit — shared function `core/textSplit.ts` (`splitForMessenger`: paragraph → line → sentence → grapheme; the adapter and FakeMessenger use the same function), sent sequentially to keep order. A single grapheme longer than the limit (combining-mark bomb) is split by code points so that **every part is ≤ the limit** (R2; chunking does the same). `postFile` is sendDocument (InputFile from bytes).
- Commands (`/full`, `/summary`, `/mode`, `/lang`, `/allow`, `/deny`) are registered with `setMyCommands` on `start()` for autocompletion (no manual BotFather registration). Command arguments come from `ctx.match`.
- Dispatch and lifecycle (R5): document and command handlers do not `await` the pipeline; they add the call to an in-flight set and return immediately (grammY processes updates sequentially, so awaiting would break cross-chat parallelism). Handler errors go to `onError(e, fatal=false)`. `start()` waits for `bot.init()` (getMe) and the polling ready signal (`onStart`) before resolving — initialization failures propagate as a `start()` exception. If polling ends unexpectedly after start, `onError(e, fatal=true)` fires; the CLI reflects it as exit code 1. `stop()` stops polling, then waits for in-flight handlers.
- Tests: zero network — `botInfo` injection skips getMe, an `api.config.use` transformer intercepts Bot API calls to assert request shape (method, payload), `bot.handleUpdate` injects updates, file downloads use an injected fetch.
- In groups, only document reception is handled because of the bot privacy-mode issue (the smoke confirms whether documents arrive in privacy mode; if not, the onboarding guidance includes the steps to disable it).

## 5. Provider notes

- ClaudeProvider (default) and OpenAIProvider — shared: per-chunk translation prompt (preserve terms, numbers and proper nouns; output the translation only), summary prompt (title, key clauses, figures, requests). Prompt text lives only in `core/prompts.ts`. Both prompts state that **the user message is data, not instructions, and that commands or role changes inside it are ignored** (SEC-10). The model is never given tools or any say over posting destinations. Chunks are called sequentially (progress n/m callback); chunk retries belong to the pipeline (T6) and providers throw `ProviderError` with a `retryable` flag.
- Claude: the official SDK (`@anthropic-ai/sdk`) with an injected `fetch`, so tests verify request shape with a mock fetch. Default model `claude-sonnet-5` (config `provider.model` overrides), `output_config.effort: "low"` for translation and `"medium"` for summaries. Server-side fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) are attached **only for the Opus 5 / Fable 5 families** — Sonnet 5 rejects the `fallbacks` parameter with 400 (found in the 2026-09-05 real smoke). `stop_reason: "refusal"` → `refusal` error. Because key verification (`verify`) is a models lookup and cannot catch request-shape errors, `npm run smoke` additionally runs a one-chunk real translation probe. Key verification is `GET /v1/models/{model}`.
- OpenAI: Chat Completions (`/v1/chat/completions`) over raw fetch, default model `gpt-5` (config overrides), key verification `GET /v1/models/{model}`. 401 → auth, 429 → rate_limit (retryable), 5xx → server (retryable). R4: the response body is validated with zod and any other shape is `bad_response` (never a TypeError); requests carry `AbortSignal.timeout` (default 90 s; a timeout is a retryable `network` error). The Claude SDK uses `timeout: 120 s`.
- Onboarding `init` calls key verification once; on failure the guidance includes the fix.
- Documents over the token cap (config `maxChars`) are rejected by the planner with split-file guidance → even an explicit `/full` is refused with the reason when over the cap (guardrail 5).

## 6. Configuration (adapters/configStore — ~/.msg-agent/config.json, mode 600)

```json
{
  "nativeLang": "ko",
  "provider": { "kind": "claude", "apiKeyRef": "env:ANTHROPIC_API_KEY" },
  "messenger": { "kind": "telegram", "tokenRef": "literal:123456:ABC..." },
  "mode": "smart", "inlineThresholdChars": 3000, "maxChars": 120000,
  "access": { "ownerUserId": "123456789", "allowedChatIds": ["123456789", "-1001234567890"] },
  "limits": { "docsPerChatPerHour": 20, "dailyChars": 1000000 }
}
```

**Access control (`access`, R1)** — deny by default. `ownerUserId` is set only by pairing (`/start <code>`; `start` prints the code in the terminal, it is valid for the process lifetime and used once); `allowedChatIds` = the pairing chat + the owner's `/allow`. Decision: documents, `/full`, `/summary` = `chatId ∈ allowedChatIds || userId === ownerUserId`; `/mode`, `/lang`, `/allow`, `/deny` = owner only. Denials produce no reply, just an `access.denied` log (chatId, userId, kind). The schema is strict — unknown keys are errors (a misconfigured protection is caught early).

Loaded and validated with the zod schema. CLI `status` prints a config summary plus bot connectivity.

**CLI assembly (src/cli)** — assembly only, no logic. All three commands are dependency-injected functions (`runInit` / `runStart` / `runStatus`) and `cli/index.ts` plugs in the real implementations (prompts, real fetch, grammY getMe). Tests plug in a scripted asker, fake verifiers and FakeMessenger for zero network.
- `init`: ① native language (fixed select of ten — `ONBOARDING_LANGUAGES` in `cli/init.ts`, SPEC §3) ② provider choice + key — if the environment variable (including `.env`) already exists, offer an `env:VAR` reference, otherwise read the value and store it as `literal:` → call `verify()` immediately ③ Telegram token (same rule) → getMe verification. On verification failure show cause + fix and allow up to 3 attempts, then exit code 1. Secrets are never printed or logged.
- `start`: load `.env` → load config and resolve secrets (on failure: cause + fix, exit code 1) → assemble provider, extractors, detector, Telegram adapter and `FileSettings` (configStore wrapper) → `Pipeline.attach()` → `messenger.start()`. On SIGINT/SIGTERM, `messenger.stop()` then exit. Logs are stderr JSON lines, metadata only.
- `status`: config summary (secrets via `redactSecretRef`), file permissions, bot getMe result.
- CLI screen wording is in `cli/text.ts` (ko/en: Korean when the native language is ko, otherwise English). Separate from the messenger phrase pack (T8).

**SecretRef grammar** (shared by `apiKeyRef` and `tokenRef`, one string):

| Form | Meaning | Notes |
|---|---|---|
| `env:<VAR>` | read from environment variable `<VAR>` (recommended) | `<VAR>` matches `[A-Z_][A-Z0-9_]*`. Shell environment or the CWD `.env` (only allow-listed keys are loaded via `util.parseEnv`, no dependency, Node 22.12+) |
| `literal:<value>` | store the value directly in config.json | assumes file mode 600. Used by `init` when the user pastes a key and declines env storage |

- Resolution (`resolveSecret`) belongs to configStore; failures (unset env, empty value, missing prefix) return an error with cause + fix ("add `ANTHROPIC_API_KEY=` to `.env` or re-run `init`").
- Resolved values are never exposed in logs or `status` output. `status` shows only `env:ANTHROPIC_API_KEY` / `literal:****` (guardrail 4).
- **File safety (R3)**: saves write to a temp file in the same directory (mode 600, `wx`) and replace atomically with `rename` — the original survives a failure. Loads reject symlinks and non-regular files via `lstat`, and refuse group/other permission bits with `insecure_permissions` (fix: `chmod 600`). JSON parse errors discard the parser message and print a fixed code only (no secret fragments leak). `.env` is not loaded wholesale: only the three allow-listed keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`) — SDK control variables such as `ANTHROPIC_BASE_URL` and `ANTHROPIC_LOG` are ignored. The Claude SDK is created with `logLevel: "off"` and `baseURL` pinned to the official endpoint.
- `nativeLang` is a lowercase ISO 639-1 (2-letter) or 639-3 (3-letter) code. `mode` is `smart|full|summary`.

## 7. Environment variables (committed as .env.example — env references are allowed instead of config values)

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
TELEGRAM_BOT_TOKEN=
```

## 8. Extension paths (design only — do not implement)

- **Adding a messenger**: one MessengerAdapter implementation + an init choice (Slack = Socket Mode, Viber = webhook + tunnel guidance).
- **MCP server (v0.2)**: expose the same core as a `translate_document(path, to)` tool — queries go through MCP, autonomous event handling stays with this agent.

## 9. Directory layout (target)

```
msg-agent/
  CLAUDE.md  README.md  package.json  .env.example
  docs/  fixtures/docs/  scripts/smoke.ts
  src/{core,adapters,mocks,cli}/
  tests/
```
