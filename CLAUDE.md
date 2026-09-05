# CLAUDE.md — msg-agent steering

A personal agent that auto-translates documents uploaded to a messenger chat into your native language. v0.1 messenger is Telegram (long polling); output uses smart mode. Spec: `docs/SPEC.md`, design: `docs/DESIGN.md`.

## Stack

- Node.js 22.12+ (required by commander 15 and `util.parseEnv`), TypeScript **strict** (including `noUncheckedIndexedAccess`)
- Telegram: **grammY** (good types, built-in long polling) — but the core never sees grammY, only `MessengerAdapter`
- Document extraction: `pdf-parse` (text-layer PDF), `mammoth` (DOCX), direct UTF-8 read (TXT/MD)
- Language detection: `franc` family (deterministic) → when unsure, delegate detection to the translation prompt
- Translation: `TranslatorProvider` interface — Claude (default) and OpenAI adapters; Gemini is a v0.2 candidate
- CLI: `commander` + `prompts` (interactive onboarding)
- Verification: Vitest + ESLint + Prettier, schemas with `zod`

## Commands

```bash
npm run check      # typecheck + lint + format:check + test (with coverage thresholds and the privacy audit) — mandatory gate for task completion
npm run test       # vitest run
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
npm run cli -- <init|start|status>   # run the CLI via tsx
npm run smoke      # manual smoke with a real Telegram bot + real provider (humans only)
```

## Source layout

```
src/
  core/        # pure logic: pipeline, chunker, outputPlanner, detector contract, config schema — no external IO
  adapters/    # telegramAdapter (grammY), extractors/, providers/ (claude, openai), configStore
  mocks/       # FakeMessenger, FakeTranslator, FixtureExtractor, FixedClock
  cli/         # init.ts (onboarding), start.ts (daemon), status.ts — assembly only
tests/  fixtures/docs/  scripts/
```

## Conventions

- The core knows nothing about adapter implementations. Adding a messenger = one `MessengerAdapter` implementation.
- No `any`. External input (messenger events, config file, provider responses) is parsed with `zod` at the boundary.
- Long work (download → extract → translate) reports progress in the chat ("Translating… 3/7 chunks") — the UX is the product.
- Error messages include the cause and the fix; user-facing messages are in the user's native language.
- Commit messages: **written in English**. Task commits use `T{n}: summary`; everything else uses a `docs:` / `chore:` / `fix:` prefix.
- All markdown documentation (root and `docs/`) is written in English. Korean appears only as product i18n data (`src/phrases/ko.ts`, `src/cli/text.ts`, `core/configMessages.ts`) and test fixtures.

## Guardrails (never violate)

1. **No document content on disk**: never leave source or translated text on disk (temp files are deleted right after processing, files for sending are deleted after sending). Logs carry metadata only (file name, size, language, timings) — **never log content, not even a fragment.**
2. **Fixed posting scope**: translation results are posted only to the chat where the document arrived. No code path may forward to other chats or external destinations.
3. **Zero network calls in tests**: messenger, translator and extractor are all mocks/fixtures.
4. API keys and bot tokens live only in the local config file (mode 600) and `.env`. Never committed, never logged.
5. **Respect cost caps**: when a document exceeds the per-document size/token limits (config), do not translate — offer summary mode or refuse with guidance. Never add a cap-bypass flag.
6. When code conflicts with the spec or design, fix `docs/` first. Output-mode policy changes go through SPEC §4 before code.

## Way of working

- One session = one task from `docs/TASKS.md`. Self-correct until every completion criterion is met and `npm run check` passes. Ask only when blocked by spec ambiguity.
- On completion, summarize changed files and verification results, then stop.

## Pruning log

Reviewed every two weeks; stale rules are deleted (`docs/WORKFLOW.md`).

- 2026-09-04: first version.
- 2026-09-06: all root and docs markdown translated to English; guardrails unchanged.
