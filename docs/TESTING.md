# TESTING — msg-agent

Purpose: verify the whole pipeline locally and deterministically without a real messenger or a real LLM. Translation quality is judged by smoke tests and real use; tests pin down **the plumbing (extract → detect → plan → split → assemble → post) and the policy (smart mode, guards)**.

## 1. Principles

- Zero network calls in tests. Messenger = FakeMessenger, translation = FakeTranslator, extraction = the real libraries (allowed because they read local files) + fixture documents.
- FakeTranslator is a deterministic marker transform: `translate` returns each chunk as `«KO:{original}»`, `summarize` lists the section titles. Assembly order and omissions are machine-checkable.
- `npm run check` = typecheck + lint + test. The whole run takes seconds.

## 2. Mocks and fixtures

| Component | Contents |
|---|---|
| `FakeMessenger` | Injects events via `emitDocument()` / `emitCommand()`, records postText/postFile calls in an array. Implements the same 4,096-character split rule |
| `FakeTranslator` | Marker transform + `failOnChunk: n` failure injection + call counting (cost-guard verification) |
| `FixtureExtractor` | Extension → fixed ExtractedDoc mapping (real-extractor unit tests are separate) |
| `FixedClock` | Deterministic timestamps for progress messages |
| fixtures/docs/ | English PDF (short/long) and MD, Spanish DOCX, Japanese TXT, Korean PDF (same-language skip), empty-text PDF (scan lookalike), encrypted PDF, RTL (Arabic) TXT, large dummy (TXT of ~130k chars for the maxChars cap; the 20 MB case is verified from metadata alone, no file). Regenerate with `npm run fixtures` (scripts/fixtures/generate.ts, needs macOS fonts) |

## 3. Golden plan cases (outputPlanner unit)

- 2,000 chars English + native ko + smart → `inline_full`
- 30,000 chars English + smart → `summary_plus_file`
- 2,000 chars + mode=summary → `summary_plus_file`
- 30,000 chars + mode=full (within the cap) → `file_full` — **full mode above the threshold still delivers the full text as a file** (no chat flooding). Only a short note (`note`) in the chat, the full text in a .md file. This policy is pinned as a case
- detected = ko (native) → `skip_same_lang`
- over maxChars → `reject` (split-file guidance)
- unsupported format (.xlsx) → `reject` (supported-format guidance)

## 4. Mandatory edge-case checklist (component — pipeline) · all items covered in T6 (tests/pipeline.test.ts, 2026-09-05)

**Input and extraction**
- [x] One happy path each for PDF/DOCX/TXT (real extractors + fixture files)
- [x] Empty-text PDF (scan) → native-language notice "no text could be extracted (OCR for scans is planned for v0.2)"
- [x] Encrypted PDF → clear notice, no crash
- [x] Metadata over 20 MB → reject without attempting a download

**Splitting and assembly**
- [x] Section-boundary-first split, order-preserving assembly (verified with markers)
- [x] One chunk failure injected → one retry → completed on success / partial-failure notice and no translation posted on repeated failure
- [x] No broken characters when splitting RTL and CJK text

**Policy and commands**
- [x] All seven golden plans (§3)
- [x] `/full` — re-runs the last document as a `file_full` plan (posts the full-text file); notice when there is no document history
- [x] `/mode`, `/lang` — config updated with a confirmation message; guidance on a bad argument
- [x] Same-language skip is a one-line reply

**Posting and privacy**
- [x] Full text over 4,096 chars → multiple postText calls split at paragraph boundaries, order guaranteed
- [x] Posting chatId = receiving chatId (a post to any other chatId fails the test)
- [x] No temporary buffers or files remain after processing / captured logs contain no body strings (checked with body signature strings)
- [x] FakeTranslator calls ≤ chunks + 1 summary (duplicate calls = cost leak guard)

**Concurrency**
- [x] Two documents uploaded at once from different chats → no mixed progress messages or results

## 5. Manual smoke (humans only — scripts/smoke.ts)

`npm run smoke -- [--chat <id>] [--wait 300]`: with a real bot token and a real provider ① getMe (group privacy mode judged from `can_read_all_group_messages`) ② provider key verification + a one-chunk real translation probe ③ start the daemon and let the human upload an English PDF → the checklist is filled from pipeline events.

**First real smoke, 2026-09-05 (passed)**: @docu_translate_bot, Claude `claude-sonnet-5`, English résumé PDF 67 KB / 4,755 chars → `summary_plus_file`, summary + `.md` file received, 55.6 s. Privacy mode confirmed off. Found and fixed: Sonnet 5 rejects the `fallbacks` parameter (400) → provider fix + the probe step.

**Re-run after the review remediation, 2026-09-06 (passed)**: owner pairing via `/start <code>`, cover-letter PDF 2,102 chars → `inline_full`, 23.5 s.

## 6. Coverage

- `src/core/` ≥ 90% — enforced by vitest thresholds in `npm run check` (statements/lines/functions 90, branches 80). Report: `docs/COVERAGE.md`. Adapters and CLI are complemented by the smoke.
- The privacy audit (`tests/privacy-audit.test.ts`) is part of check too: static scan (fixed allow-lists for disk writes and console) + runtime signature check (success and failure paths). Never delete or weaken it.
